import AsyncStorage from '@react-native-community/async-storage';
import WalletConnectClient, { CLIENT_EVENTS } from '@walletconnect/clientv2';
import { Reason, SessionTypes } from '@walletconnect/typesv2';
import { Alert, InteractionManager } from 'react-native';
import { isSigningMethod } from '../utils/signingMethods';
import { sendRpcCall } from '@rainbow-me/handlers/web3';
import { Navigation } from '@rainbow-me/navigation';
import { addRequestToApproveV2 } from '@rainbow-me/redux/requests';
import Routes from '@rainbow-me/routes';

let client: WalletConnectClient;

const RAINBOW_METADATA = {
  description: 'Rainbow makes exploring Ethereum fun and accessible 🌈',
  icons: ['https://avatars2.githubusercontent.com/u/48327834?s=200&v=4'],
  name: '🌈 Rainbow',
  url: 'https://rainbow.me',
};

const SUPPORTED_MAIN_CHAINS = [
  'eip155:1',
  'eip155:10',
  'eip155:137',
  'eip155:42161',
];

const SUPPORTED_TEST_CHAINS = ['eip155:3', 'eip155:4', 'eip155:5', 'eip155:42'];

const toEIP55Format = (chainId: string) => `eip155:${chainId}`;
export const fromEIP55Format = (chain: string) => chain.replace('eip155:', '');

const getAddressAndChainIdFromWCAccount = (
  account: string
): { address: string; chainId: number } => {
  const [address, eip155Network] = account.split('@');
  const chainId = fromEIP55Format(eip155Network);
  return { address, chainId: Number(chainId) };
};

const generateWalletConnectAccount = (address: string, chain: string) =>
  `${address}@${chain}`;

// eslint-disable-next-line no-console
const wcLogger = (a: String, b?: any) => console.info(`::: WC ::: ${a}`, b);

const isSupportedChain = (chain: string) =>
  SUPPORTED_MAIN_CHAINS.includes(chain) ||
  SUPPORTED_TEST_CHAINS.includes(chain);

export const walletConnectInit = async (dispatch: any) => {
  client = await WalletConnectClient.init({
    controller: true,
    logger: 'fatal',
    metadata: RAINBOW_METADATA,
    relayProvider: 'wss://relay.walletconnect.org',
    storageOptions: {
      asyncStorage: AsyncStorage as any,
    },
  });

  wcLogger('Client started!');
  client.on(
    CLIENT_EVENTS.session.proposal,
    async (proposal: SessionTypes.Proposal) => {
      const { proposer, permissions } = proposal;
      const { metadata } = proposer;
      const chains = permissions.blockchain.chains;

      // should we connect several networks at the same time?
      if (!isSupportedChain(chains[0])) {
        Alert.alert('Chain not supported', `${chains[0]} is not supported`);
        wcLogger('rejected');
        client.reject({ proposal });
        return;
      }
      wcLogger('chainid', fromEIP55Format(chains[0]));
      const { name, url, icons } = metadata;
      Navigation.handleAction(Routes.WALLET_CONNECT_APPROVAL_SHEET, {
        callback: (
          approved: boolean,
          chainId: string,
          accountAddress: string
        ) => {
          if (approved) {
            wcLogger('approved');
            const chain = toEIP55Format(chainId);
            const response: SessionTypes.Response = {
              metadata: RAINBOW_METADATA,
              state: {
                accounts: [generateWalletConnectAccount(accountAddress, chain)],
              },
            };
            client.approve({ proposal, response });
          } else {
            wcLogger('rejected');
            client.reject({ proposal });
          }
        },
        chainId: fromEIP55Format(chains[0]),
        meta: {
          dappName: name,
          dappUrl: url,
          imageUrl: icons?.[0],
        },
      });
    }
  );

  client.on(
    CLIENT_EVENTS.session.created,
    async (session: SessionTypes.Created) => {
      // session created succesfully
      wcLogger('SessionTypes.session', session);
    }
  );

  client.on(
    CLIENT_EVENTS.session.request,
    async (requestEvent: SessionTypes.RequestEvent) => {
      wcLogger('CLIENT_EVENTS.session.request');
      // WalletConnect client can track multiple sessions
      // assert the topic from which application requested
      wcLogger('CLIENT_EVENTS.session requestEvent', requestEvent);
      const { topic, request } = requestEvent;
      const session = await client.session.get(requestEvent.topic);
      wcLogger('CLIENT_EVENTS.session', session);
      // now you can display to the user for approval using the stored metadata
      const { metadata } = session.peer;
      wcLogger('metadata', metadata);
      wcLogger('request', request);
      wcLogger('session', session);
      const { method, params } = request;
      const payload = { method, params };
      wcLogger('request method', method);
      wcLogger('request params', params);

      if (method === 'wallet_addEthereumChain') {
        wcLogger('wallet_addEthereumChain');
      } else if (!isSigningMethod(method)) {
        sendRpcCall(request)
          .then(async result => {
            const response = {
              response: {
                id: request.id,
                jsonrpc: '2.0',
                result,
              },
              topic,
            };
            await client.respond(response);
          })
          .catch(async () => {
            const response = {
              response: {
                error: {
                  // this code is wrong
                  code: -32000,
                  message: 'JSON RPC method not supported',
                },
                id: request.id,
                jsonrpc: '2.0',
              },
              topic,
            };
            await client.respond(response);
          });
        return;
      } else {
        // check for read only accounts
        // TODO

        const requestToApprove = await dispatch(
          addRequestToApproveV2(request.id, payload, metadata)
        );

        wcLogger('request V2', requestToApprove);

        if (requestToApprove) {
          // analytics.track('Showing Walletconnect signing request');
          InteractionManager.runAfterInteractions(() => {
            Navigation.handleAction(Routes.CONFIRM_REQUEST, {
              callback: async (res: { error: string; result: string }) => {
                const { error, result } = res;
                const response = {
                  response: {
                    id: request.id,
                    jsonrpc: '2.0',
                    ...(error
                      ? {
                          error: {
                            // this code is wrong
                            code: -32000,
                            message: error,
                          },
                        }
                      : { result }),
                  },
                  topic,
                };
                await client.respond(response);
              },
              openAutomatically: true,
              transactionDetails: requestToApprove,
            });
          });
        }
      }
    }
  );
};

export const walletConnectGetClient = () => client;
export const walletConnectAllSessions = (): {
  account: string;
  chainId: number;
  dappIcon: string;
  dappName: string;
  dappUrl: string;
}[] => {
  return (
    client?.session?.values?.map(value => {
      const accounts = value?.state?.accounts;
      const { name, url, icons } = value?.peer?.metadata;
      const { address, chainId } = getAddressAndChainIdFromWCAccount(
        accounts[0]
      );
      return {
        account: address,
        chainId,
        dappIcon: icons[0],
        dappName: name,
        dappUrl: url,
      };
    }) || []
  );
};

export const walletConnectDisconnectAllSessions = () => {
  wcLogger('walletConnectDisconnectAllSessions', client.session.values.length);
  const sessions = client.session.values;
  sessions.forEach(session => {
    walletConnectDisconnect(session.topic);
  });
};

export const walletConnectDisconnectByDappName = (dappName: string) => {
  const session = client?.session?.values?.find(
    value => dappName === value?.peer?.metadata?.name
  );
  walletConnectDisconnect(session.topic);
};

export const walletConnectDisconnect = (topic: string) => {
  const reason: Reason = {
    code: 400,
    message: 'User disconnected',
  };
  client.disconnect({ reason, topic });
};

export const walletConnectPair = async (uri: string) => {
  const pair = await client.pair({ uri });
  wcLogger('on walletConnectPair', pair);
};
