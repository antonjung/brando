# Brando — Two-Device Connection

## Overview

Brando uses peer-to-peer WebRTC (via PeerJS) to connect two devices directly, with no server in the middle once the connection is established. One device acts as the **audition device** (the actor) and the other as the **reader device** (the person reading cue lines).

---

## Roles

| Device | Role | Tab used |
|--------|------|----------|
| Device A | Actor / Auditionee — sees their own lines scroll | ME |
| Device B | Reader — sees all script sections and controls playback | THEM (via QR) |

---

## Connection Flow

### 1. Device A — tap ME

- The app creates a PeerJS peer and is assigned a unique peer ID.
- A QR code is generated containing the app URL with the peer ID embedded as a query parameter:
  ```
  https://antonjung.github.io/brando/?peer=<PEER_ID>
  ```
- Device A shows "Waiting for reader…" and waits.

### 2. Device B — scan the QR code

- Device B opens the URL in its browser.
- The app detects the `?peer=` parameter on load.
- Device B creates its own peer and connects to Device A's peer ID.
- The connection is direct device-to-device over WebRTC (no relay server for data).

### 3. Script transfer

- Once the connection opens, Device A automatically sends the full script to Device B as a JSON message.
- Device B enters reader mode and displays all script sections.

### 4. Enter Audition Mode (Device A)

- Device A shows a "Reader connected!" status and an **Enter Audition Mode** button.
- Tapping it puts Device A into fullscreen mode — a blank black screen with a pulsing dot, waiting for cues.

### 5. Live interaction

Device B taps a section in reader mode:

- **THEM section tapped** → sends `{ type: 'clear' }` to Device A → Device A's screen goes blank.
- **ME section tapped** → sends `{ type: 'show_me', text: '...' }` to Device A → Device A displays the ME lines, which scroll upward at the configured scroll speed.

Device B's status dot turns green when connected and red if the connection drops.

---

## What the THEM tab does (no QR)

Tapping **THEM** on any device enters reader mode locally with no network connection. This is useful for testing or rehearsing solo without a second device. The script sections are displayed and can be tapped through, but no signals are sent anywhere.

---

## Technical notes

- PeerJS uses STUN servers to negotiate the WebRTC connection. The actual script data and cue messages travel directly between the two devices.
- The connection is only as reliable as the local network / cellular signal on both devices.
- If the connection drops, Device B shows a red status dot and a "Disconnected" toast. Reconnection requires starting the ME flow again on Device A.
- The QR URL cleans itself from the browser history immediately after being read (`history.replaceState`) so refreshing the page returns to the normal home screen.
