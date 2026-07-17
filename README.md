# 🎤 LyricLearner

Learn the lyrics of any real song. The actual song plays (YouTube), pauses right before
each line, and waits for you to guess the next phrase.

## Play it

- **Online:** https://raoko.github.io/lyriclearner/
- **Locally:** `node server.js` → http://localhost:3000 (the console also prints a
  LAN address for your phone on the same Wi-Fi)

The site is fully static (`docs/` folder) — lyrics come straight from the free
[LRCLIB](https://lrclib.net) API in the browser, and the audio is the real YouTube video.

## How to play

1. Pick a song from the **🐰 Bad Bunny Top 10 starter pack** (lyrics + video pre-wired),
   or **search any song** and paste its YouTube link ("Find it ↗" opens a YouTube search).
2. Pick a mode:
   - **Quiz** — pick the missing word from 4 choices
   - **🚗 Drive** — hands-free: say the line out loud, tap **✓ Got it** or **↻ Missed it**.
     A miss rewinds, replays the line with the words shown, then quizzes you again.
   - **🧠 Builder** — memorize cumulatively, one word at a time. Words get hidden in order
     and stay hidden; the song pauses before your current word so you can pull it from
     memory (✓ Got it / 👁 Show me), plays the line, then restarts — from 2 lines back or
     the whole song (↩ toggle). Progress is saved per song, so you can build a song over days.

   (Typing modes were removed — not practical mid-song. Voice recognition is planned.)
3. The song plays and pauses before each quizzed line. Answer, hear the line, keep going.
4. **Loop a section:** tap the first and last line of a section in the lyrics panel and
   the app repeats just that part (chorus, fast verse…), re-quizzing you every pass.
   Your latest attempt at each line is what counts. Tap ✕ to clear the loop.
   Toggle the loop to **🔂 Repeat mode** to skip the quizzing entirely — the section just
   replays with the words shown and a 1-second breather between passes.
5. **Stuck on a line?** Tap **💡 Reveal a word** to uncover it one word at a time instead
   of giving up the whole line (each peeked word costs a bit of credit).

If the pauses feel early or late (e.g. the video has an intro), use the **−0.25s / +0.25s**
sync buttons during the game — the offset is saved per song.

Songs you've played are saved to your library (browser localStorage) with your best
accuracy, the YouTube video, and the sync offset.

Typo-friendly: one-letter typos on longer words still count, accents are ignored.

## iPhone

Open the site in Safari → Share → **Add to Home Screen** to install it like an app.

⚠️ Don't use Drive mode while actually driving — keep your eyes on the road.
