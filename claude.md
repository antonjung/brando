# Overview
Brando is a pwa app to aide actors putting together self tapes using the Brando technique.

The Brando technique has lines for the auditionee (A) made visible to them but the other lines hidden
Another actor (B) reads the cue lines 

# Implementation

## Set up

The app connects 2 devices,

User of one device can import a pdf, give it a name, split it into sections, assign sections to "ME" or "THEM"
This results in a script.
The App provides a QR code

User on another device user scans the QR code which connects them to A. the script is transferred to their device.

Both devices can contain multiple scripts.

# Operation

A goes into audition mode and selects the script. no text is displayed on the screen

B goes into reader mode and selects the script. Each section of the script is displayed separately 

As B touches each "THEM" section the screen fades and clears on device A
As B touches each "ME" section the screen on device A shows the ME line only centered on the screen, the text scrolls down the page. the rate of scroll is set in settings.


A settings menu with a gear icon on the top right slides in and out
the following settings:
Scroll rate
Font size
theme including dyslexia friendly
Me and Them text

Top left is a hamburger menu which slides in and out containing
Import PDF
Add, Edit, Delete notes

# PDF splitting

The PDF is imported as a single block. A name is provided and a script created.

clicking anywhere on the block creates a block from the block start to the current position - the block can be assigned to "ME" or "THEM"

"ME" and "THEM" can be changed in settings

clicking again on a block boundary removes the boundary 

When complete the script is marked as such 

A QR code can be displayed for the script

# Deployment
github repo antonjung/brando
use pages to deploy