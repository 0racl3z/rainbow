import { toLower } from 'lodash';
import {
  COVALENT_ANDROID_API_KEY,
  COVALENT_IOS_API_KEY,
} from 'react-native-dotenv';
import { polygonEnabled } from '../config/debug';
// eslint-disable-next-line import/no-cycle
import { addressAssetsReceived, fetchAssetPrices } from './data';
// eslint-disable-next-line import/no-cycle
import { emitAssetRequest, emitChartsRequest } from './explorer';
import { AssetTypes } from '@rainbow-me/entities';
//import networkInfo from '@rainbow-me/helpers/networkInfo';
import networkTypes from '@rainbow-me/helpers/networkTypes';
import { ethereumUtils } from '@rainbow-me/utils';
import logger from 'logger';

// -- Constants --------------------------------------- //
export const POLYGON_MAINNET_RPC_ENDPOINT = 'https://rpc-mainnet.matic.network';
const POLYGON_EXPLORER_CLEAR_STATE = 'explorer/POLYGON_EXPLORER_CLEAR_STATE';
const POLYGON_EXPLORER_SET_ASSETS = 'explorer/POLYGON_EXPLORER_SET_ASSETS';
const POLYGON_EXPLORER_SET_BALANCE_HANDLER =
  'explorer/POLYGON_EXPLORER_SET_BALANCE_HANDLER';
const POLYGON_EXPLORER_SET_HANDLERS = 'explorer/POLYGON_EXPLORER_SET_HANDLERS';
const POLYGON_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER =
  'explorer/POLYGON_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER';

const UPDATE_BALANCE_AND_PRICE_FREQUENCY = 30000;
const network = networkTypes.polygon;
let tokenMapping = {};

const fetchAssetsMapping = async () => {
  const fetchPage = async page => {
    try {
      const limit = 200;
      const url = `https://tokenmapper.api.matic.today/api/v1/mapping?map_type=[%22POS%22]&chain_id=137&limit=${limit}&offset=${
        limit * page
      }`;
      const request = await fetch(url);
      const response = await request.json();
      if (response.message === 'success') {
        return response.data;
      }
      return null;
    } catch (e) {
      logger.log(`Error trying to fetch polygon token map`, e);
      return null;
    }
  };

  let next = true;
  let page = 0;
  let fullMapping = [];
  while (next) {
    const pageData = await fetchPage(page);
    next = pageData.has_next_page;
    fullMapping = fullMapping.concat(pageData.mapping);
    if (next) {
      page++;
    }
  }

  const mapping = {};
  fullMapping.forEach(mappingData => {
    mapping[`${toLower(mappingData.child_token)}`] = mappingData.root_token;
  });
  return mapping;
};

const getAssetsFromCovalent = async (
  chainId,
  address,
  type,
  currency,
  coingeckoIds,
  allAssets,
  genericAssets
) => {
  const url = `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?nft=false&quote-currency=${currency}&key=${
    ios ? COVALENT_IOS_API_KEY : COVALENT_ANDROID_API_KEY
  }`;
  const request = await fetch(url);
  const response = await request.json();
  if (response.data && !response.error) {
    const updatedAt = new Date(response.data.update_at).getTime();
    const assets = response.data.items.map(item => {
      let mainnetAddress = tokenMapping[toLower(item.contract_address)];
      let coingeckoId = coingeckoIds[toLower(mainnetAddress)];
      let price = {
        changed_at: updatedAt,
        relative_change_24h: 0,
      };

      // Overrides
      if (
        toLower(mainnetAddress) ===
        toLower('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
      ) {
        mainnetAddress = 'eth';
        coingeckoId = 'ethereum';
      } else if (
        toLower(item.contract_address) ===
        toLower('0x0000000000000000000000000000000000001010')
      ) {
        mainnetAddress = '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0';
        coingeckoId = 'matic-network';
      }

      const fallbackAsset =
        ethereumUtils.getAsset(allAssets, toLower(mainnetAddress)) ||
        genericAssets[toLower(mainnetAddress)];

      if (fallbackAsset) {
        price = {
          ...price,
          ...fallbackAsset.price,
        };
      }

      return {
        asset: {
          asset_code: item.contract_address,
          coingecko_id: coingeckoId,
          decimals: item.contract_decimals,
          icon_url: item.logo_url,
          mainnet_address: mainnetAddress,
          name: item.contract_name.replace(' (PoS)', ''),
          price: {
            value: item.quote_rate || 0,
            ...price,
          },
          symbol: item.contract_ticker_symbol,
          type,
        },
        quantity: Number(item.balance),
      };
    });

    return assets;
  }
  return null;
};

export const polygonExplorerInit = () => async (dispatch, getState) => {
  if (!polygonEnabled) return;
  const { accountAddress, nativeCurrency } = getState().settings;
  const { assets: allAssets, genericAssets } = getState().data;
  const { coingeckoIds } = getState().additionalAssetsData;
  const formattedNativeCurrency = toLower(nativeCurrency);
  tokenMapping = await fetchAssetsMapping();

  const fetchAssetsBalancesAndPrices = async () => {
    const chainId = ethereumUtils.getChainIdFromNetwork(network);
    const assets = await getAssetsFromCovalent(
      chainId,
      accountAddress,
      AssetTypes.polygon,
      formattedNativeCurrency,
      coingeckoIds,
      allAssets,
      genericAssets
    );

    if (!assets || !assets.length) {
      const polygonExplorerBalancesHandle = setTimeout(
        fetchAssetsBalancesAndPrices,
        10000
      );
      dispatch({
        payload: {
          polygonExplorerBalancesHandle,
        },
        type: POLYGON_EXPLORER_SET_BALANCE_HANDLER,
      });
      return;
    }

    const tokenAddresses = assets.map(
      ({ asset: { asset_code } }) => asset_code
    );

    dispatch(emitAssetRequest(tokenAddresses));
    dispatch(emitChartsRequest(tokenAddresses));

    const prices = await fetchAssetPrices(
      assets.map(({ asset: { coingecko_id } }) => coingecko_id),
      formattedNativeCurrency
    );

    if (prices) {
      Object.keys(prices).forEach(key => {
        for (let i = 0; i < assets.length; i++) {
          if (toLower(assets[i].asset.coingecko_id) === toLower(key)) {
            if (!assets[i].asset.price.relative_change_24h) {
              assets[i].asset.price.relative_change_24h =
                prices[key][`${formattedNativeCurrency}_24h_change`];
            }
            break;
          }
        }
      });
    }

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

    const polygonExplorerBalancesHandle = setTimeout(
      fetchAssetsBalancesAndPrices,
      UPDATE_BALANCE_AND_PRICE_FREQUENCY
    );
    let polygonExplorerAssetsHandle = null;

    dispatch({
      payload: {
        polygonExplorerAssetsHandle,
        polygonExplorerBalancesHandle,
      },
      type: POLYGON_EXPLORER_SET_HANDLERS,
    });
  };
  fetchAssetsBalancesAndPrices();
};

export const polygonExplorerClearState = () => (dispatch, getState) => {
  const {
    polygonExplorerBalancesHandle,
    polygonExplorerAssetsHandle,
  } = getState().polygonExplorer;

  polygonExplorerBalancesHandle && clearTimeout(polygonExplorerBalancesHandle);
  polygonExplorerAssetsHandle && clearTimeout(polygonExplorerAssetsHandle);
  dispatch({ type: POLYGON_EXPLORER_CLEAR_STATE });
};

// -- Reducer ----------------------------------------- //
const INITIAL_STATE = {
  assetsFound: [],
  polygonExplorerAssetsHandle: null,
  polygonExplorerBalancesHandle: null,
};

export default (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case POLYGON_EXPLORER_SET_ASSETS:
      return {
        ...state,
        assetsFound: action.payload.assetsFound,
      };
    case POLYGON_EXPLORER_CLEAR_STATE:
      return {
        ...state,
        ...INITIAL_STATE,
      };
    case POLYGON_EXPLORER_SET_LATEST_TX_BLOCK_NUMBER:
      return {
        ...state,
        latestTxBlockNumber: action.payload.latestTxBlockNumber,
      };
    case POLYGON_EXPLORER_SET_HANDLERS:
      return {
        ...state,
        polygonExplorerAssetsHandle: action.payload.polygonExplorerAssetsHandle,
        polygonExplorerBalancesHandle:
          action.payload.polygonExplorerBalancesHandle,
      };
    case POLYGON_EXPLORER_SET_BALANCE_HANDLER:
      return {
        ...state,
        polygonExplorerBalancesHandle:
          action.payload.polygonExplorerBalancesHandle,
      };
    default:
      return state;
  }
};
