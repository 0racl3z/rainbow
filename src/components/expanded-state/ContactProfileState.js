import React, { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import styled from 'styled-components';
import { useTheme } from '../../context/ThemeContext';
import { useNavigation } from '../../navigation/Navigation';
import { abbreviations, defaultProfileUtils, magicMemo } from '../../utils';
import Divider from '../Divider';
import { ButtonPressAnimation } from '../animations';
import { Button } from '../buttons';
import { showDeleteContactActionSheet } from '../contacts';
import CopyTooltip from '../copy-tooltip';
import { Centered } from '../layout';
import { Text, TruncatedAddress, TruncatedENS } from '../text';
import { ProfileAvatarButton, ProfileModal, ProfileNameInput } from './profile';
import {
  removeFirstEmojiFromString,
  returnStringFirstEmoji,
} from '@rainbow-me/helpers/emojiHandler';
import { isENSAddressFormat } from '@rainbow-me/helpers/validators';
import { useAccountSettings, useContacts } from '@rainbow-me/hooks';
import { margin, padding } from '@rainbow-me/styles';

const AddressAbbreviation = styled(TruncatedAddress).attrs(
  ({ theme: { colors } }) => ({
    align: 'center',
    color: colors.blueGreyDark,
    firstSectionLength: abbreviations.defaultNumCharsPerSection,
    size: 'lmedium',
    truncationLength: 4,
    weight: 'regular',
  })
)`
  ${margin(9, 0, 5)};
  opacity: 0.6;
  width: 100%;
`;

const ENSAbbreviation = styled(TruncatedENS).attrs(({ theme: { colors } }) => ({
  align: 'center',
  color: colors.blueGreyDark,
  size: 'lmedium',
  truncationLength: 18,
  weight: 'regular',
}))`
  ${margin(9, 0, 5)};
  opacity: 0.6;
  width: 100%;
`;

const Spacer = styled.View`
  height: 19;
`;

const SubmitButton = styled(Button).attrs(
  ({ theme: { colors }, value, color }) => ({
    backgroundColor:
      value.length > 0
        ? typeof color === 'string'
          ? color
          : colors.avatarBackgrounds[color] || colors.appleBlue
        : undefined,
    disabled: !value.length > 0,
    showShadow: true,
    size: 'small',
  })
)`
  height: 43;
  width: 215;
`;

const SubmitButtonLabel = styled(Text).attrs(({ value }) => ({
  color: value.length > 0 ? 'whiteLabel' : 'white',
  size: 'lmedium',
  weight: 'bold',
}))`
  margin-bottom: 1.5;
`;

const ContactProfileState = ({ address, color: colorProp, contact }) => {
  const { goBack } = useNavigation();
  const { onAddOrUpdateContacts, onRemoveContact } = useContacts();
  const [color, setColor] = useState(colorProp || 0);
  const [value, setValue] = useState(
    removeFirstEmojiFromString(contact?.nickname || '')
  );
  const [emoji, setEmoji] = useState(returnStringFirstEmoji(contact?.nickname));
  const inputRef = useRef(null);
  const { network } = useAccountSettings();

  const handleAddContact = useCallback(() => {
    const nickname = (emoji ? `${emoji} ${value}` : value).trim();
    if (value.length > 0 || color !== colorProp) {
      onAddOrUpdateContacts(address, nickname, color, network);
      goBack();
    }
    android && Keyboard.dismiss();
  }, [
    address,
    color,
    colorProp,
    emoji,
    goBack,
    network,
    onAddOrUpdateContacts,
    value,
  ]);

  const handleDeleteContact = useCallback(() => {
    showDeleteContactActionSheet({
      address,
      nickname: value,
      onDelete: goBack,
      removeContact: onRemoveContact,
    });
    android && Keyboard.dismiss();
  }, [address, goBack, onRemoveContact, value]);

  const handleTriggerFocusInput = useCallback(() => inputRef.current?.focus(), [
    inputRef,
  ]);

  const isContact = contact && !contact.temporary;

  const { isDarkMode, colors } = useTheme();

  const handleChangeAvatar = useCallback(() => {
    const prevAvatarIndex = defaultProfileUtils.avatars.findIndex(
      avatar => avatar.emoji === emoji
    );
    const nextAvatarIndex =
      (prevAvatarIndex + 1) % defaultProfileUtils.avatars.length;
    setColor(defaultProfileUtils.avatars[nextAvatarIndex]?.colorIndex);
    setEmoji(defaultProfileUtils.avatars[nextAvatarIndex]?.emoji);
  }, [emoji, setColor]);

  return (
    <ProfileModal onPressBackdrop={handleAddContact}>
      <Centered css={padding(24, 25)} direction="column">
        <ProfileAvatarButton
          changeAvatar={handleChangeAvatar}
          color={color}
          marginBottom={0}
          radiusAndroid={32}
          testID="contact-profile-avatar-button"
          value={emoji || value}
        />
        <Spacer />
        <ProfileNameInput
          onChange={setValue}
          onSubmitEditing={handleAddContact}
          placeholder="Name"
          ref={inputRef}
          selectionColor={colors.avatarBackgrounds[color]}
          testID="contact-profile-name-input"
          value={value}
        />
        <CopyTooltip
          onHide={handleTriggerFocusInput}
          textToCopy={address}
          tooltipText="Copy Address"
        >
          {isENSAddressFormat(address) ? (
            <ENSAbbreviation ens={address} />
          ) : (
            <AddressAbbreviation address={address} />
          )}
        </CopyTooltip>
        <Centered paddingVertical={19} width={93}>
          <Divider inset={false} />
        </Centered>
        <SubmitButton
          color={color}
          isDarkMode={isDarkMode}
          onPress={handleAddContact}
          testID="contact-profile-add-button"
          value={value}
        >
          <SubmitButtonLabel value={value}>
            {isContact ? 'Done' : 'Add Contact'}
          </SubmitButtonLabel>
        </SubmitButton>
        <ButtonPressAnimation
          marginTop={11}
          onPress={
            isContact
              ? handleDeleteContact
              : () => {
                  goBack();
                  android && Keyboard.dismiss();
                }
          }
        >
          <Centered
            backgroundColor={colors.white}
            css={padding(8, 9)}
            testID="contact-profile-cancel-button"
          >
            <Text
              color={colors.alpha(colors.blueGreyDark, 0.4)}
              size="lmedium"
              weight="regular"
            >
              {isContact ? 'Delete Contact' : 'Cancel'}
            </Text>
          </Centered>
        </ButtonPressAnimation>
      </Centered>
    </ProfileModal>
  );
};

export default magicMemo(ContactProfileState, ['address', 'color', 'contact']);
