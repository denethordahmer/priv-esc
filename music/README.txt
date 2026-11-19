PRIV-ESC — MUSIC FOLDER
========================================

File names follow one rule, so the folder order is also the playing order:

  00 PRIV ESC.mp3         the title theme, looped on the title screen
  01 Cold Boot.mp3         first in-game track
  02 Boot Loop.mp3        second, and so on

Two digits, a space, then the title. The title is what the game shows in
Settings > Music tracks; the number decides the order.

Adding a track: rename the file to the next free number + title, run

  node tools/music-manifest.js

and commit both the mp3 and music/manifest.json. The tool also reads the
length of each track from the file, so the Settings list can show it.

At runtime the game picks a random order each round, never opening a round
with the track that just played. The player can pick one track to repeat in
Settings > Music tracks.

Each track fades out over its last two seconds, then there is a two second
silence, then the next one starts.

Sound is off by default. Turn it on in Settings > Sound.

The prompts for the tracks are in
/storage/emulated/0/Documents/priv-esc-music-prompts.txt
