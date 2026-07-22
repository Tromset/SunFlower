# TODO

## UI :

- [ ] Change the thinking animations so the points become bees flying around the sunflower
- [ ] The little notch on the top of the screen should only appear when SunFlower is running something
- [ ] If it's an agent running : keep a little circle on the side of the screen that contain a sunflower representing what the agents currently doing
- [ ] Create new animations like the sunflower with a laptop on the side when it's writing code (be creative)

## UX :

- [ ] The user should be able to dock the sunflower to watch videos without a huge flower floating in the middle of the screen
- [ ] A user should be able to switch models whenever he wants to so we have to add a "sunflower-models" command to browse models and download them from Ollama



## Backend :

- [ ] There is literally a thing that KILLS YOUR COMPUTER if you DARE RUN the FUCKING THING So we gotta fix that quick or people are going to chase me for the murder of their device. 👎
- [ ] Before hunting the above blind: add a lightweight watchdog around the Electron app (CPU/RSS sampling on an interval, logged to `~/Library/Application Support/sunflower/`) so next time it happens we have a trace of what actually spiked — screen capture loop, whisper.cpp, a leaked `BrowserWindow`, a runaway Ollama load — instead of guessing again.
- [ ] We need to add the agents tab :
  - It triggers the same system we used for [Ollama-Code](https://github.com/Tromset/Ollama-Code)
  - The agents must be running in the background and then tell the user when it's finished
  - The agents don't actually edit anything they just write code and then ask the user to review it, deny it or accept it
- [ ] If the action asked isn't a code based action, trigger Sunflower Work that can click on your computer :
  **(only recommended if you leave your computer there because it'll take a long time to think before clicking anywhere)**
- [ ] `/chat` can come back HTTP 200 while the real failure is hiding inside an `error` event in the stream body (see README Troubleshooting: "answers come back empty"). Neither the Electron app nor the macOS app surfaces that event to the user right now — a bad/missing Ollama model just looks like dead air. Wire it through to something visible: a toast, a spoken error line, a terminal message.

## Security & Privacy :

- [ ] `apps/macos/Glide/GlideAnalytics.swift` initialises PostHog with a hardcoded key on every launch and reports the user's messages and the AI's responses; `CompanionManager.swift`'s onboarding flow also POSTs the user's email to the upstream author's form endpoint. Both run by default in every build, which directly contradicts the "no screenshots leaving your Mac" pitch in the README. Remove them, or put them behind an explicit opt-in setting.
- [ ] `apps/macos/Glide.xcodeproj/project.pbxproj` has the upstream author's real `CLERK_PUBLISHABLE_KEY` and `DEVELOPMENT_TEAM` committed straight into Build Settings. Anyone who builds without manually swapping them silently authenticates against someone else's Clerk app and gets 401s with no clue why. Move these into a gitignored `.xcconfig` with a checked-in `.xcconfig.example`, so a fresh clone fails loudly at build time instead of quietly hitting the wrong backend.