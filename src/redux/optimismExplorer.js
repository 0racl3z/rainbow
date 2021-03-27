import { BigNumber } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import { toLower } from 'lodash';
import { optimismMainnet } from '../config/debug';
// eslint-disable-next-line import/no-cycle
import { addressAssetsReceived, fetchAssetPrices } from './data';
import networkInfo from '@rainbow-me/helpers/networkInfo';
import {
  balanceCheckerContractAbiOVM,
  testnetAssets,
} from '@rainbow-me/references';
import logger from 'logger';

// -- Constants --------------------------------------- //
export const OPTIMISM_KOVAN_RPC_ENDPOINT = 'https://kovan.optimism.io';
export const OPTIMISM_MAINNET_RPC_ENDPOINT = 'https://mainnet.optimism.io';
const OPTIMISM_EXPLORER_CLEAR_STATE = 'explorer/OPTIMISM_EXPLORER_CLEAR_STATE';
const OPTIMISM_EXPLORER_SET_ASSETS = 'explorer/OPTIMISM_EXPLORER_SET_ASSETS';
const OPTIMISM_EXPLORER_SET_BALANCE_HANDLER =
  'explorer/OPTIMISM_EXPLORER_SET_BALANCE_HANDLER';
const OPTIMISM_EXPLORER_SET_HANDLERS =
  'explorer/OPTIMISM_EXPLORER_SET_HANDLERS';
const OPTIMISM_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER =
  'explorer/OPTIMISM_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER';

const UPDATE_BALANCE_AND_PRICE_FREQUENCY = 10000;

const optimsimProvider = new JsonRpcProvider(
  optimismMainnet ? OPTIMISM_MAINNET_RPC_ENDPOINT : OPTIMISM_KOVAN_RPC_ENDPOINT
);

const network = optimismMainnet ? 'ovm' : 'kovanovm';

const fetchAssetBalances = async (tokens, address) => {
  const abi = balanceCheckerContractAbiOVM;

  const contractAddress = networkInfo[network].balance_checker_contract_address;

  const balanceCheckerContract = new Contract(
    contractAddress,
    abi,
    optimsimProvider
  );

  try {
    const values = await balanceCheckerContract.balances([address], tokens);
    const balances = {};
    [address].forEach((addr, addrIdx) => {
      balances[addr] = {};
      tokens.forEach((tokenAddr, tokenIdx) => {
        const balance = values[addrIdx * tokens.length + tokenIdx];
        balances[addr][tokenAddr] = balance.toString();
      });
    });
    return balances[address];
  } catch (e) {
    logger.log(
      'Error fetching balances from balanceCheckerContract',
      network,
      e
    );
    return null;
  }
};

export const optimismExplorerInit = () => async (dispatch, getState) => {
  const { accountAddress, nativeCurrency } = getState().settings;
  const formattedNativeCurrency = toLower(nativeCurrency);

  const fetchAssetsBalancesAndPrices = async () => {
    logger.log('🔴 optimismExplorer fetchAssetsBalancesAndPrices');
    const assets = testnetAssets[network];
    if (!assets || !assets.length) {
      const optimismExplorerBalancesHandle = setTimeout(
        fetchAssetsBalancesAndPrices,
        10000
      );
      dispatch({
        payload: {
          optimismExplorerBalancesHandle,
        },
        type: OPTIMISM_EXPLORER_SET_BALANCE_HANDLER,
      });
      return;
    }

    const prices = await fetchAssetPrices(
      assets.map(({ asset: { coingecko_id } }) => coingecko_id),
      formattedNativeCurrency
    );

    if (prices) {
      Object.keys(prices).forEach(key => {
        for (let i = 0; i < assets.length; i++) {
          if (toLower(assets[i].asset.coingecko_id) === toLower(key)) {
            assets[i].asset.price = {
              changed_at: prices[key].last_updated_at,
              relative_change_24h:
                prices[key][`${formattedNativeCurrency}_24h_change`],
              value: prices[key][`${formattedNativeCurrency}`],
            };
            break;
          }
        }
      });
    }
    const balances = await fetchAssetBalances(
      assets.map(({ asset: { asset_code } }) => asset_code),
      accountAddress,
      network
    );

    let total = BigNumber.from(0);

    if (balances) {
      Object.keys(balances).forEach(key => {
        for (let i = 0; i < assets.length; i++) {
          if (assets[i].asset.asset_code.toLowerCase() === key.toLowerCase()) {
            assets[i].quantity = balances[key];
            break;
          }
        }
        total = total.add(balances[key]);
      });
    }

    logger.log('🔴 optimismExplorer updating assets');
    dispatch(
      addressAssetsReceived(
        {
          meta: {
            address: accountAddress,
            currency: nativeCurrency,
            status: 'ok',
          },
          payload: { assets },
        },
        true
      )
    );

    const optimismExplorerBalancesHandle = setTimeout(
      fetchAssetsBalancesAndPrices,
      UPDATE_BALANCE_AND_PRICE_FREQUENCY
    );
    let optimismExplorerAssetsHandle = null;

    dispatch({
      payload: {
        optimismExplorerAssetsHandle,
        optimismExplorerBalancesHandle,
      },
      type: OPTIMISM_EXPLORER_SET_HANDLERS,
    });
  };
  fetchAssetsBalancesAndPrices();
};

export const optimismExplorerClearState = () => (dispatch, getState) => {
  const {
    optimismExplorerBalancesHandle,
    optimismExplorerAssetsHandle,
  } = getState().optimismExplorer;

  optimismExplorerBalancesHandle &&
    clearTimeout(optimismExplorerBalancesHandle);
  optimismExplorerAssetsHandle && clearTimeout(optimismExplorerAssetsHandle);
  dispatch({ type: OPTIMISM_EXPLORER_CLEAR_STATE });
};

// -- Reducer ----------------------------------------- //
const INITIAL_STATE = {
  assetsFound: [],
  optimismExplorerAssetsHandle: null,
  optimismExplorerBalancesHandle: null,
};

export default (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case OPTIMISM_EXPLORER_SET_ASSETS:
      return {
        ...state,
        assetsFound: action.payload.assetsFound,
      };
    case OPTIMISM_EXPLORER_CLEAR_STATE:
      return {
        ...state,
        ...INITIAL_STATE,
      };
    case OPTIMISM_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER:
      return {
        ...state,
        latestTxBlockNumber: action.payload.latestTxBlockNumber,
      };
    case OPTIMISM_EXPLORER_SET_HANDLERS:
      return {
        ...state,
        optimismExplorerAssetsHandle:
          action.payload.optimismExplorerAssetsHandle,
        optimismExplorerBalancesHandle:
          action.payload.optimismExplorerBalancesHandle,
      };
    case OPTIMISM_EXPLORER_SET_BALANCE_HANDLER:
      return {
        ...state,
        optimismExplorerBalancesHandle:
          action.payload.optimismExplorerBalancesHandle,
      };
    default:
      return state;
  }
};
