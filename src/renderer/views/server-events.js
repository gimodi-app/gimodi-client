import serverService from '../services/server.js';
import voiceService from '../services/voice.js';
import screenShareService from '../services/screen.js';
import { openChannelViewTab, updateChatBadges, updateChatNickColors } from './chat.js';

/**
 * Creates event handler functions bound to the shared server view state.
 * @param {Object} state - Shared mutable state from the server view
 * @param {Array} state.channels - Channel list
 * @param {Array} state.clients - Client list
 * @param {Function} state.getCurrentChannelId - Gets current channel ID
 * @param {Function} state.setCurrentChannelId - Sets current channel ID
 * @param {Set} state.talkingClients - Set of talking client IDs
 * @param {Set} state.webcamClients - Set of webcam client IDs
 * @param {Set} state.mutedClients - Set of muted client IDs
 * @param {Set} state.deafenedClients - Set of deafened client IDs
 * @param {Set} state.voiceGrantedClients - Set of voice-granted client IDs
 * @param {Set} state.voiceRequestClients - Set of voice-request client IDs
 * @param {Set} state.streamingClients - Set of streaming client IDs
 * @param {Function} state.renderChannelTree - Re-renders the channel tree
 * @param {Function} state.playSound - Plays a feedback sound
 * @param {Function} state.switchChannel - Switches to a channel
 * @param {Function} state.updateChannelTabLabel - Updates the channel tab label
 * @param {Function} state.getChannels - Returns the current channels array
 * @param {Function} state.setChannels - Sets the channels array
 * @param {Function} state.getClients - Returns the current clients array
 * @param {Function} state.setClients - Sets the clients array
 * @param {Object} state.sounds - Sound objects
 * @param {Audio} state.sounds.connect - Connect sound
 * @param {Audio} state.sounds.disconnect - Disconnect sound
 * @param {Audio} state.sounds.screenStart - Screen share start sound
 * @param {Audio} state.sounds.screenStop - Screen share stop sound
 * @param {Audio} state.sounds.webcamStart - Webcam start sound
 * @param {Audio} state.sounds.webcamStop - Webcam stop sound
 * @param {HTMLElement} state.btnLeaveVoice - Leave voice button element
 * @param {HTMLElement} state.btnCreateChannel - Create channel button element
 * @returns {Object} Event handler functions
 */
export function createEventHandlers(state) {
  /**
   * Handles being force-joined to a channel by the server.
   * @param {CustomEvent} e - Event with channelId, moderated, voiceGranted, readRestricted, writeRestricted in detail
   * @returns {void}
   */
  function onForceJoined(e) {
    const { channelId, moderated, voiceGranted, readRestricted, writeRestricted } = e.detail;
    if (channelId === state.getCurrentChannelId()) {
      return;
    }

    if (screenShareService.isSharing) {
      screenShareService.stopSharing();
    }
    voiceService.cleanup();

    if (moderated && voiceGranted) {
      for (const id of voiceGranted) {
        state.voiceGrantedClients.add(id);
      }
    }

    state.setCurrentChannelId(channelId);
    state.btnLeaveVoice.classList.remove('hidden');
    state.updateChannelTabLabel(channelId);

    const clients = state.getClients();
    const self = clients.find((c) => c.id === serverService.clientId);
    if (self) {
      self.channelId = channelId;
    }

    state.renderChannelTree();
    state.playSound(state.sounds.connect);

    const channels = state.getChannels();
    const forcedChannel = channels.find((c) => c.id === channelId);
    if (forcedChannel) {
      openChannelViewTab(channelId, forcedChannel.name, undefined, !!readRestricted, !!writeRestricted);
    }

    window.dispatchEvent(new CustomEvent('gimodi:channel-changed', { detail: { channelId } }));
  }

  /**
   * Handles a new client joining the server.
   * @param {CustomEvent} e - Event with client details in detail
   * @returns {void}
   */
  function onClientJoined(e) {
    const { clientId, userId, nickname, channelId, badge, roleColor, rolePosition, fingerprint, observe } = e.detail;
    if (observe) {
      return;
    }
    const newClient = {
      id: clientId,
      userId: userId || null,
      nickname,
      channelId,
      badge: badge || null,
      roleColor: roleColor || null,
      rolePosition: rolePosition ?? Infinity,
      fingerprint: fingerprint || null,
    };
    const clients = state.getClients();
    clients.push(newClient);
    window.gimodiClients = clients;
    state.renderChannelTree();
  }

  /**
   * Handles a client leaving the server.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onClientLeft(e) {
    const { clientId } = e.detail;
    const filtered = state.getClients().filter((c) => c.id !== clientId);
    state.setClients(filtered);
    window.gimodiClients = filtered;
    state.webcamClients.delete(clientId);
    state.streamingClients.delete(clientId);
    state.mutedClients.delete(clientId);
    state.deafenedClients.delete(clientId);
    state.voiceGrantedClients.delete(clientId);
    state.voiceRequestClients.delete(clientId);
    voiceService.removeConsumersForClient(clientId);
    state.renderChannelTree();
  }

  /**
   * Handles an admin role change for a client.
   * @param {CustomEvent} e - Event with clientId, badge, roleColor, rolePosition in detail
   * @returns {void}
   */
  function onAdminChanged(e) {
    const { clientId, badge, roleColor, rolePosition } = e.detail;
    const clients = state.getClients();
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      client.badge = badge ?? null;
      client.roleColor = roleColor ?? null;
      if (rolePosition !== undefined) {
        client.rolePosition = rolePosition;
      }
      updateChatBadges(client.userId, badge ?? null);
      updateChatNickColors(client.userId, roleColor ?? null);
    }
    state.renderChannelTree();
  }

  /**
   * Handles a role color change affecting multiple users.
   * @param {CustomEvent} e - Event with roleColor and userIds in detail
   * @returns {void}
   */
  function onRoleColorChanged(e) {
    const { roleColor, userIds } = e.detail;
    if (!userIds || !Array.isArray(userIds)) {
      return;
    }
    for (const userId of userIds) {
      updateChatNickColors(userId, roleColor ?? null);
    }
  }

  /**
   * Handles a permissions change for the current user.
   * @param {CustomEvent} e - Event with permissions array in detail
   * @returns {void}
   */
  function onPermissionsChanged(e) {
    const { permissions } = e.detail;
    serverService.permissions = new Set(permissions);
    window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
    state.btnCreateChannel.style.display =
      serverService.hasPermission('channel.create') || serverService.hasPermission('channel.create_temporary') || serverService.hasPermission('channel.group_create') ? '' : 'none';
  }

  /**
   * Handles a client being moved to a different channel.
   * @param {CustomEvent} e - Event with clientId and toChannelId in detail
   * @returns {void}
   */
  function onClientMoved(e) {
    const { clientId, toChannelId } = e.detail;
    const clients = state.getClients();
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      client.channelId = toChannelId;
    }
    state.renderChannelTree();
  }

  /**
   * Handles a user joining a voice channel.
   * @param {CustomEvent} e - Event with clientId, userId, channelId, nickname in detail
   * @returns {void}
   */
  function onChannelUserJoined(e) {
    const { clientId, userId, channelId, nickname } = e.detail;
    const clients = state.getClients();
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      client.channelId = channelId;
    } else {
      clients.push({ id: clientId, userId: userId || null, nickname, channelId });
    }
    if (channelId === state.getCurrentChannelId() && clientId !== serverService.clientId) {
      state.playSound(state.sounds.connect);
    }
    state.renderChannelTree();
  }

  /**
   * Handles a user leaving a voice channel.
   * @param {CustomEvent} e - Event with clientId and channelId in detail
   * @returns {void}
   */
  function onChannelUserLeft(e) {
    const { clientId, channelId } = e.detail;
    if (channelId === state.getCurrentChannelId() && clientId !== serverService.clientId) {
      state.playSound(state.sounds.disconnect);
    }
    state.renderChannelTree();
  }

  /**
   * Handles a new channel being created on the server.
   * @param {CustomEvent} e - Event with channel object in detail
   * @returns {void}
   */
  function onChannelCreated(e) {
    const { channel } = e.detail;
    const channels = state.getChannels();
    if (!channels.find((c) => c.id === channel.id)) {
      channels.push(channel);
    }
    window.gimodiChannels = channels;
    state.renderChannelTree();
  }

  /**
   * Handles a channel being deleted from the server.
   * @param {CustomEvent} e - Event with channelId in detail
   * @returns {void}
   */
  function onChannelDeleted(e) {
    const { channelId } = e.detail;
    const filtered = state.getChannels().filter((c) => c.id !== channelId);
    state.setChannels(filtered);
    window.gimodiChannels = filtered;
    state.renderChannelTree();
  }

  /**
   * Handles a channel being updated on the server.
   * @param {CustomEvent} e - Event with channel object in detail
   * @returns {void}
   */
  function onChannelUpdated(e) {
    const { channel } = e.detail;
    const channels = state.getChannels();
    const clients = state.getClients();
    const idx = channels.findIndex((c) => c.id === channel.id);
    if (idx >= 0) {
      channels[idx] = { ...channels[idx], ...channel };
    } else {
      channels.push(channel);
      window.gimodiChannels = channels;
    }
    if (!channel.moderated) {
      const channelClients = clients.filter((c) => c.channelId === channel.id);
      for (const c of channelClients) {
        state.voiceGrantedClients.delete(c.id);
        state.voiceRequestClients.delete(c.id);
      }
    }
    if (channel.id === state.getCurrentChannelId() && channel.moderated) {
      window.dispatchEvent(new CustomEvent('gimodi:channel-moderated-changed', { detail: { moderated: true } }));
    } else if (channel.id === state.getCurrentChannelId() && !channel.moderated) {
      window.dispatchEvent(new CustomEvent('gimodi:channel-moderated-changed', { detail: { moderated: false } }));
    }
    state.renderChannelTree();
  }

  /**
   * Handles a peer starting their webcam.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onWebcamStarted(e) {
    const { clientId } = e.detail;
    state.webcamClients.add(clientId);
    state.renderChannelTree();
    state.playSound(state.sounds.webcamStart);
  }

  /**
   * Handles a peer stopping their webcam.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onWebcamStopped(e) {
    const { clientId } = e.detail;
    state.webcamClients.delete(clientId);
    state.renderChannelTree();
    state.playSound(state.sounds.webcamStop);
  }

  /**
   * Handles the local user starting their webcam.
   * @returns {void}
   */
  function onLocalWebcamStarted() {
    state.webcamClients.add(serverService.clientId);
    state.renderChannelTree();
  }

  /**
   * Handles the local user stopping their webcam.
   * @returns {void}
   */
  function onLocalWebcamStopped() {
    state.webcamClients.delete(serverService.clientId);
    state.renderChannelTree();
  }

  /**
   * Handles a peer starting screen sharing.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onPeerScreenStarted(e) {
    const { clientId } = e.detail;
    state.streamingClients.add(clientId);
    state.renderChannelTree();
    state.playSound(state.sounds.screenStart);
  }

  /**
   * Handles a peer stopping screen sharing.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onPeerScreenStoppedIndicator(e) {
    const { clientId } = e.detail;
    state.streamingClients.delete(clientId);
    state.renderChannelTree();
    state.playSound(state.sounds.screenStop);
  }

  /**
   * Handles the local user starting screen sharing.
   * @returns {void}
   */
  function onLocalScreenStartedIndicator() {
    state.streamingClients.add(serverService.clientId);
    state.renderChannelTree();
  }

  /**
   * Handles the local user stopping screen sharing.
   * @returns {void}
   */
  function onLocalScreenStoppedIndicator() {
    state.streamingClients.delete(serverService.clientId);
    state.renderChannelTree();
  }

  /**
   * Handles a peer's mute or deafen state changing.
   * @param {CustomEvent} e - Event with clientId, muted, deafened in detail
   * @returns {void}
   */
  function onPeerMuteStateChanged(e) {
    const { clientId, muted, deafened } = e.detail;
    if (muted) {
      state.mutedClients.add(clientId);
    } else {
      state.mutedClients.delete(clientId);
    }
    if (deafened) {
      state.deafenedClients.add(clientId);
    } else {
      state.deafenedClients.delete(clientId);
    }
    updateMuteIcons(clientId);
  }

  /**
   * Handles the local user's mute state changing.
   * @returns {void}
   */
  function onLocalMuteChanged() {
    const id = serverService.clientId;
    if (voiceService._manualMute || voiceService._deafened) {
      state.mutedClients.add(id);
    } else {
      state.mutedClients.delete(id);
    }
    updateMuteIcons(id);
  }

  /**
   * Handles the local user's deafen state changing.
   * @returns {void}
   */
  function onLocalDeafenChanged() {
    const id = serverService.clientId;
    if (voiceService._manualMute || voiceService._deafened) {
      state.mutedClients.add(id);
    } else {
      state.mutedClients.delete(id);
    }
    if (voiceService._deafened) {
      state.deafenedClients.add(id);
    } else {
      state.deafenedClients.delete(id);
    }
    updateMuteIcons(id);
  }

  /**
   * Re-syncs the local user's voice indicators from voiceService/screenShareService state.
   * Called after restoring server view state when switching back to the voice server.
   * @returns {void}
   */
  function syncLocalVoiceIndicators() {
    const id = serverService.clientId;
    if (!id) {
      return;
    }
    if (voiceService._manualMute || voiceService._deafened) {
      state.mutedClients.add(id);
    } else {
      state.mutedClients.delete(id);
    }
    if (voiceService._deafened) {
      state.deafenedClients.add(id);
    } else {
      state.deafenedClients.delete(id);
    }
    if (voiceService.webcamProducer) {
      state.webcamClients.add(id);
    } else {
      state.webcamClients.delete(id);
    }
    if (screenShareService.isSharing) {
      state.streamingClients.add(id);
    } else {
      state.streamingClients.delete(id);
    }
    state.renderChannelTree();
  }

  /**
   * Handles voice being granted to a client in a moderated channel.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onVoiceGranted(e) {
    const { clientId } = e.detail;
    state.voiceGrantedClients.add(clientId);
    state.voiceRequestClients.delete(clientId);
    state.renderChannelTree();
    if (clientId === serverService.clientId) {
      window.dispatchEvent(new CustomEvent('gimodi:voice-granted'));
    }
  }

  /**
   * Handles voice being revoked from a client in a moderated channel.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onVoiceRevoked(e) {
    const { clientId } = e.detail;
    state.voiceGrantedClients.delete(clientId);
    state.renderChannelTree();
    if (clientId === serverService.clientId) {
      window.dispatchEvent(new CustomEvent('gimodi:voice-revoked'));
    }
  }

  /**
   * Handles a client requesting voice in a moderated channel.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onVoiceRequested(e) {
    const { clientId } = e.detail;
    state.voiceRequestClients.add(clientId);
    state.renderChannelTree();
  }

  /**
   * Handles a client cancelling their voice request in a moderated channel.
   * @param {CustomEvent} e - Event with clientId in detail
   * @returns {void}
   */
  function onVoiceRequestCancelled(e) {
    const { clientId } = e.detail;
    state.voiceRequestClients.delete(clientId);
    state.renderChannelTree();
  }

  /**
   * Updates the mute/deafen icons for a specific client in the channel tree.
   * @param {string} clientId - The client ID to update icons for
   * @returns {void}
   */
  function updateMuteIcons(clientId) {
    const indicators = document.querySelectorAll(`.voice-indicator[data-client-id="${clientId}"]`);
    for (const el of indicators) {
      const isMuted = state.mutedClients.has(clientId);
      const isDeafened = state.deafenedClients.has(clientId);
      if (isDeafened) {
        el.className = 'voice-indicator mute-status';
        el.innerHTML = '<i class="bi bi-volume-mute"></i>';
        el.title = 'Deafened';
      } else if (isMuted) {
        el.className = 'voice-indicator mute-status';
        el.innerHTML = '<i class="bi bi-mic-mute"></i>';
        el.title = 'Muted';
      } else {
        el.className = 'voice-indicator';
        el.innerHTML = '';
        el.title = '';
      }
    }
  }

  /**
   * Handles a client's talking state changing in voice chat.
   * @param {CustomEvent} e - Event with clientId and talking boolean in detail
   * @returns {void}
   */
  function onTalkingChanged(e) {
    const { clientId, talking } = e.detail;
    if (talking) {
      state.talkingClients.add(clientId);
    } else {
      state.talkingClients.delete(clientId);
    }
    const clients = state.getClients();
    const client = clients.find((c) => c.id === clientId);
    const inCurrentChannel = client && client.channelId === state.getCurrentChannelId();
    const indicators = document.querySelectorAll(`.voice-indicator[data-client-id="${clientId}"]`);
    for (const el of indicators) {
      el.classList.toggle('talking', talking && inCurrentChannel);
    }
  }

  return {
    onForceJoined,
    onClientJoined,
    onClientLeft,
    onAdminChanged,
    onRoleColorChanged,
    onPermissionsChanged,
    onClientMoved,
    onChannelUserJoined,
    onChannelUserLeft,
    onChannelCreated,
    onChannelDeleted,
    onChannelUpdated,
    onWebcamStarted,
    onWebcamStopped,
    onLocalWebcamStarted,
    onLocalWebcamStopped,
    onPeerScreenStarted,
    onPeerScreenStoppedIndicator,
    onLocalScreenStartedIndicator,
    onLocalScreenStoppedIndicator,
    onPeerMuteStateChanged,
    onLocalMuteChanged,
    onLocalDeafenChanged,
    syncLocalVoiceIndicators,
    onVoiceGranted,
    onVoiceRevoked,
    onVoiceRequested,
    onVoiceRequestCancelled,
    updateMuteIcons,
    onTalkingChanged,
  };
}
