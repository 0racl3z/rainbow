import { useRoute } from '@react-navigation/native';
import React, { useMemo } from 'react';
import styled from 'styled-components/primitives';
import { HoldToAuthorizeButton } from '../buttons';
import { Centered } from '../layout';
import { ExchangeModalTypes } from '@rainbow-me/helpers';
import {
  useColorForAsset,
  useGas,
  useSlippageDetails,
} from '@rainbow-me/hooks';
import Routes from '@rainbow-me/routes';
import { colors, padding } from '@rainbow-me/styles';

const paddingHorizontal = 19;
const shadows = {
  default: [[0, 10, 30, colors.black, 0.4]],
  disabled: [
    [0, 10, 30, colors.dark, 0.2],
    [0, 5, 15, colors.blueGreyDark50, 0.4],
  ],
};

const ConfirmButton = styled(HoldToAuthorizeButton).attrs({
  hideInnerBorder: true,
  parentHorizontalPadding: paddingHorizontal,
  theme: 'dark',
})`
  flex: 1;
`;

const Container = styled(Centered)`
  ${padding(5, paddingHorizontal, 0)};
  width: 100%;
`;

export default function ConfirmExchangeButton({
  asset,
  disabled,
  isSufficientBalance,
  isSufficientLiquidity,
  onPressViewDetails,
  onSubmit,
  slippage,
  type = ExchangeModalTypes.swap,
  ...props
}) {
  const { name: routeName } = useRoute();
  const colorForAsset = useColorForAsset(asset);
  const { isSufficientGas } = useGas();
  const { isHighSlippage } = useSlippageDetails(slippage);

  const shadowsForAsset = useMemo(
    () => [
      [0, 10, 30, colors.dark, 0.2],
      [0, 5, 15, colorForAsset, 0.4],
    ],
    [colorForAsset]
  );

  const isSwapDetailsRoute = routeName === Routes.SWAP_DETAILS_SHEET;

  let label = '';
  if (type === ExchangeModalTypes.deposit) {
    label = 'Hold to Deposit';
  } else if (type === ExchangeModalTypes.swap) {
    label = 'Hold to Swap';
  } else if (type === ExchangeModalTypes.withdrawal) {
    label = 'Hold to Withdraw';
  }

  if (!isSufficientBalance) {
    label = 'Insufficient Funds';
  } else if (!isSufficientLiquidity) {
    label = 'Insufficient Liquidity';
  } else if (!isSufficientGas) {
    label = 'Insufficient ETH';
  } else if (isHighSlippage) {
    label = isSwapDetailsRoute ? 'Swap Anyway' : '􀕹 View Details';
  } else if (disabled) {
    label = 'Enter an Amount';
  }

  const isDisabled =
    disabled ||
    !isSufficientBalance ||
    !isSufficientGas ||
    !isSufficientLiquidity;

  const shouldOpenSwapDetails = isHighSlippage && !isSwapDetailsRoute;

  return (
    <Container>
      <ConfirmButton
        backgroundColor={colorForAsset}
        disableLongPress={shouldOpenSwapDetails}
        disabled={isDisabled}
        disabledBackgroundColor={
          isSwapDetailsRoute ? colors.blueGreyDark50 : colors.grey20
        }
        label={label}
        onLongPress={shouldOpenSwapDetails ? onPressViewDetails : onSubmit}
        shadows={
          isSwapDetailsRoute
            ? isDisabled
              ? shadows.disabled
              : shadowsForAsset
            : shadows.default
        }
        showBiometryIcon={!isDisabled && !isHighSlippage}
        {...props}
      />
    </Container>
  );
}
