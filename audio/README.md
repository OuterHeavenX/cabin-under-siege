# Recorded audio (optional)

The game ships with generated, physically-modelled sound so it works with no audio
files at all. You can replace any sound with a real recording:

1. Put the file (`.ogg`, `.mp3`, `.m4a` or `.wav`) in this folder, e.g. `audio/sfx/pistol-1.ogg`.
2. List it in `audio/manifest.json` under the sound's name. Give several files for a
   sound to get random variations (each play also gets a slight random pitch shift):

```json
{
  "sfx": {
    "shot": ["sfx/pistol-1.ogg", "sfx/pistol-2.ogg"],
    "glass": "sfx/glass-break.ogg"
  },
  "music": {
    "day": "music/day-theme.ogg",
    "night": "music/night-theme.ogg",
    "tense": "music/siege-theme.ogg"
  }
}
```

Listed sounds still get the game's distance, stereo placement and indoor/outdoor reverb.
Anything not listed (or that fails to load) falls back to the generated version.
For music, each file loops while that mood is active (`day`/`town` share `day` unless
`town` is listed separately).

Only use audio whose license allows it. Good sources: Kenney.nl audio packs (CC0),
Sonniss GDC Game Audio Bundles (royalty-free for games), Freesound.org (check each
file's license — CC0 needs no credit; CC-BY needs credit in this README).

## Sound names

| Name | Plays when |
|---|---|
| `shot`, `shotgun`, `rifleShot` | You fire the handgun / shotgun / rifle |
| `enemyShot`, `rifle` | Attackers fire a pistol / rifle (the lieutenant uses `shotgun`) |
| `reload`, `reloadDone`, `shell`, `empty`, `swap` | Magazine change, slide release, loading a shell, dry fire, switching weapons |
| `hit`, `impact`, `ricochet` | Bullet hits a person / a surface / ricochets |
| `hurt`, `thud`, `swing`, `dodge` | You take damage, melee hit, melee/throw swing, dodge roll |
| `step` | Footsteps (generated version varies by surface) |
| `glass`, `wood`, `door`, `doorBreak`, `hammer` | Windows breaking, wood hits, doors opening, doors broken, repairs |
| `chop`, `treefall` | Axe strike, tree coming down |
| `molotov`, `fire`, `trap` | Molotov burst, fire crackle, bear trap snap |
| `pickup`, `coin`, `heal`, `eat` | Picking up items / cash, bandaging, eating |
| `car`, `phone`, `alarm`, `warning` | Driving, phone ringing, tripwire alarm, attack warning |
| `ui`, `blip`, `chime`, `jobDone`, `levelup`, `victory`, `defeat`, `miss` | Interface and reward sounds |
