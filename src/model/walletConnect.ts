import AsyncStorage from '@react-native-community/async-storage';
import analytics from '@segment/analytics-react-native';
import { captureException } from '@sentry/react-native';
import WalletConnectClient, { CLIENT_EVENTS } from '@walletconnectv2/client';
import { Reason, SessionTypes } from '@walletconnectv2/types';
import lang from 'i18n-js';
import { Alert, InteractionManager, Linking } from 'react-native';
import { enableActionsOnReadOnlyWallet } from '../config/debug';
import { isSigningMethod } from '../utils/signingMethods';
import { sendRpcCall } from '@rainbow-me/handlers/web3';
import { delay } from '@rainbow-me/helpers/utilities';
import walletTypes from '@rainbow-me/helpers/walletTypes';
import { Navigation } from '@rainbow-me/navigation';
import { addRequestToApproveV2 } from '@rainbow-me/redux/requests';
import { RAINBOW_METADATA } from '@rainbow-me/redux/walletconnect';
import Routes from '@rainbow-me/routes';
import { logger, watchingAlert } from '@rainbow-me/utils';

// eslint-disable-next-line no-console
const wcLogger = (a: String, b?: any) =>
  console.info(`::: WC 🐞🐞🐞 ::: ${a}`, b);

const wcTrack = (
  event: string,
  metadata: { name: string; url: string },
  opts?: object
) =>
  analytics.track(event, {
    dappName: metadata?.name || metadata.url,
    dappUrl: metadata.url,
    version: 'v2',
    ...opts,
  });

const SUPPORTED_MAIN_CHAINS = [
  'eip155:1',
  'eip155:10',
  'eip155:137',
  'eip155:42161',
];

const SUPPORTED_TEST_CHAINS = ['eip155:3', 'eip155:4', 'eip155:5', 'eip155:42'];

const notSupportedResponse = (id: number) => ({
  error: {
    code: -32601,
    message: 'JSON RPC method not supported',
  },
  id,
  jsonrpc: '2.0',
});

const toEIP55Format = (chainId: string | number) => `eip155:${chainId}`;
export const fromEIP55Format = (chain: string) => chain?.replace('eip155:', '');

const generateWalletConnectAccount = (address: string, chain: string) =>
  `${address}@${chain}`;

const isSupportedChain = (chain: string) =>
  SUPPORTED_MAIN_CHAINS.includes(chain) ||
  SUPPORTED_TEST_CHAINS.includes(chain);

// const getPush =

export const getAddressAndChainIdFromWCAccount = (
  account: string
): { address: string; chainId: number } => {
  const [address, eip155Network] = account.split('@');
  const chainId = fromEIP55Format(eip155Network);
  return { address, chainId: Number(chainId) };
};

export const walletConnectV2HandleAction = (type: string, scheme?: string) => {
  if (scheme) {
    Linking.openURL(`${scheme}://`);
  } else {
    return Navigation.handleAction(Routes.WALLET_CONNECT_REDIRECT_SHEET, {
      type,
    });
  }
};

let client: WalletConnectClient;

export const walletConnectInit = async (store: any) => {
  if (!client) {
    wcLogger('🚗 🚗 🚗  WC INIT', client);
    client = await WalletConnectClient.init({
      controller: true,
      logger: 'debug',
      metadata: RAINBOW_METADATA,
      relayProvider: 'wss://relay.walletconnect.org',
      storageOptions: {
        asyncStorage: AsyncStorage as any,
      },
    });
    wcLogger('🚗 🚗 🚗  WC INITIALIZED', client);

    wcLogger('Client started!');
    client.on(
      CLIENT_EVENTS.session.proposal,
      async (proposal: SessionTypes.Proposal) => {
        wcLogger('🚗 🚗 🚗  CLIENT_EVENTS.session.proposal', client);
        try {
          wcLogger('CLIENT_EVENTS.session.proposal');
          const { proposer, permissions } = proposal;
          const { metadata } = proposer;
          const chains = permissions.blockchain.chains;
          wcLogger('CLIENT_EVENTS.session.proposal 2');

          if (!isSupportedChain(chains[0])) {
            Alert.alert('Chain not supported', `${chains[0]} is not supported`);
            wcTrack('Walletconnect chain not supported', metadata, {
              chain: chains[0],
            });
            client.reject({ proposal });
            return;
          }
          wcTrack('Showing Walletconnect session request', metadata);
          wcLogger('CLIENT_EVENTS.session.proposal 3');

          Navigation.handleAction(Routes.WALLET_CONNECT_APPROVAL_SHEET, {
            callback: async (
              approved: boolean,
              chainId: string,
              accountAddress: string
            ) => {
              if (approved) {
                const chain = toEIP55Format(chainId);
                const walletConnectAccount = generateWalletConnectAccount(
                  accountAddress,
                  chain
                );
                const response: SessionTypes.Response = {
                  metadata: RAINBOW_METADATA,
                  state: {
                    accounts: [walletConnectAccount],
                  },
                };
                wcTrack('Approved new WalletConnect session', metadata);
                walletConnectV2HandleAction('connect');
                await client.approve({ proposal, response });
              } else {
                wcTrack('Rejected new WalletConnect session', metadata);
                walletConnectV2HandleAction('reject');
                await client.reject({ proposal });
              }
              return client.session.values;
            },
            chainId: fromEIP55Format(chains?.[0]),
            meta: {
              dappName: metadata.name,
              dappUrl: metadata.url,
              imageUrl: metadata.icons?.[0],
            },
            version: 'v2',
          });
        } catch (error) {
          logger.log('Exception during wc session.proposal');
          analytics.track('Exception on wc session.proposal', {
            error,
            version: 'v2',
          });
          captureException(error);
          Alert.alert(lang.t('wallet.wallet_connect.error'));
        }
      }
    );

    wcLogger('Client started! on 1');

    // client.on(
    //   CLIENT_EVENTS.session.created,
    //   async (session: SessionTypes.Settled) => {
    // // axios post push url
    // axios.post("<PUSH_URL>", {
    //   bridge: "https://relay.walletconnect.org",
    //   topic: session.topic,
    //   type,
    //   token,
    //   peerName: session.peer.metadata.name,
    //   language
    // })
    //     console.log('🚗 🚗 🚗  CLIENT_EVENTS.session.created', client);
    //   }
    // );

    // client.on(CLIENT_EVENTS.pairing.created,
    // // axios post push url
    // axios.post("<PUSH_URL>", {
    //   bridge: "https://relay.walletconnect.org",
    //   topic: session.topic,
    //   type,
    //   token,
    //   language
    // })

    client.on(
      CLIENT_EVENTS.session.request,
      async (requestEvent: SessionTypes.RequestEvent) => {
        wcLogger('🚗 🚗 🚗  CLIENT_EVENTS.session.request', client);
        try {
          const { topic, request } = requestEvent;
          const session = await client.session.get(requestEvent.topic);

          if (request.method === 'wallet_addEthereumChain') {
            wcLogger('wallet_addEthereumChain');
          } else if (!isSigningMethod(request.method)) {
            wcLogger('!isSigningMethod');
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
                  response: notSupportedResponse(request.id),
                  topic,
                };
                await client.respond(response);
              });
            return;
          } else {
            wcLogger('e;lse');
            const { dispatch, getState } = store;
            const { selected } = getState().wallets;
            const selectedWallet = selected || {};
            const isReadOnlyWallet =
              selectedWallet.type === walletTypes.readOnly;
            if (isReadOnlyWallet && !enableActionsOnReadOnlyWallet) {
              watchingAlert();
              const response = {
                response: notSupportedResponse(request.id),
                topic,
              };
              await client.respond(response);
              return;
            }

            const requestToApprove = await dispatch(
              addRequestToApproveV2(request.id, session, request)
            );

            wcLogger('requestToApprove', requestToApprove);

            if (requestToApprove) {
              InteractionManager.runAfterInteractions(() => {
                wcTrack('Showing Walletconnect signing request', session);
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
                                // internal error
                                code: -32603,
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
        } catch (error) {
          logger.log('Exception during wc session.request');
          analytics.track('Exception on wc session.request', {
            error,
            version: 'v2',
          });
          captureException(error);
          Alert.alert(lang.t('wallet.wallet_connect.error'));
        }
      }
    );
    wcLogger('Client started! on 2');
  }

  return client;
};

export const walletConnectDisconnectAllSessions = async () => {
  const sessions = client.session.values;
  const disconnectSessions = sessions.map(session => () =>
    walletConnectDisconnect(session.topic)
  );
  await Promise.all(disconnectSessions);
  return client.session.values;
};

export const walletConnectUpdateSessionByDappName = async (
  dappName: string,
  newAccountAddress: string,
  newChainId: string
) => {
  const sessions = client?.session?.values;
  const session = sessions?.find(
    value => dappName === value?.peer?.metadata?.name
  );
  const { address } = getAddressAndChainIdFromWCAccount(newAccountAddress);
  const eip55ChainId = toEIP55Format(newChainId);
  const newAccount = generateWalletConnectAccount(address, eip55ChainId);
  session.permissions = {
    ...session.permissions,
    blockchain: {
      chains: [eip55ChainId],
    },
  };
  session.state.accounts = [newAccount];
  await client.upgrade({
    permissions: {
      blockchain: {
        chains: [eip55ChainId],
      },
    },
    topic: session.topic,
  });
  await client.update({
    state: session.state.accounts,
    topic: session.topic,
  });

  return client.session.values;
};

export const walletConnectDisconnectByDappName = async (dappName: string) => {
  wcLogger('walletConnectDisconnectByDappName', client?.session?.values);
  const session = client?.session?.values?.find(value => {
    wcLogger('value', value);
    return dappName === value?.peer?.metadata?.name;
  });
  wcLogger('walletConnectDisconnect', session.topic);
  await walletConnectDisconnect(session.topic);
  wcLogger('disconnected', client.session.values);
  return client.session.values;
};

const walletConnectDisconnect = async (topic: string) => {
  const reason: Reason = {
    code: 400,
    message: 'User disconnected',
  };
  wcLogger('walletConnectDisconnect ---- ------ ', client);
  await client.disconnect({ reason, topic });
};

export const walletConnectPair = async (uri: string) => {
  wcLogger('on about to walletConnectPair', uri);
  while (!client) {
    delay(300);
  }
  wcLogger('on about to walletConnectPair dalay out', !!client);
  const pair = await client.pair({ uri });
  wcLogger('on walletConnectPair', pair);
  Navigation.handleAction(Routes.WALLET_CONNECT_APPROVAL_SHEET, {
    callback: () => null,
    chainId: null,
    meta: null,
    version: 'v2',
  });
};
