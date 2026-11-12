# How Cheap Are You? 🛒

A Black Friday price-guessing party game for team meetings.

The host shares their screen. Everyone else joins from their own phone or laptop with a funny name.
Each of the 7 rounds shows an inside-joke item, players guess its price, and the closest guesses win points.

## How a round works

There are 6 normal rounds and 1 bonus round. Each round lasts 30 seconds.

1. The host's screen shows the item's picture. Each item has a **secret ceiling price** that nobody sees until the round is over.
2. Players type a guess on their device. The host sees who has guessed, but not what they guessed.
3. When the timer runs out (or the host clicks **Lock guesses & reveal**), the ceiling and all guesses are revealed.
4. The **highest guess that is not over the ceiling** gets **2 points**, and the second highest gets **1 point**. Guessing exactly the ceiling is fine. Anything over the ceiling is disqualified and scores 0. If two guesses are equal, the one sent first wins.
5. The **bonus round** (round 7) has no ceiling, so the highest guess wins.
6. The host shows the leaderboard, then starts the next round. After the bonus round there's a podium.

## Running a game

1. Open `/host` on the computer you will screen-share.
2. The 7 rounds come pre-filled with default items and pictures. Change any picture, name or ceiling price. Everything is saved in that browser as you type, and **Reset to default items** brings the defaults back. **Save game file** downloads a backup you can load on another computer.
3. Click **Open the doors**. Share your screen and paste the invite link in the meeting chat.
4. Players open the link, pick a name (the 🎲 button makes one up), and wait for round 1.

If a player's browser refreshes, they rejoin automatically with the same name and score.
If the host's tab refreshes, the game resumes too.

## Run it locally

```bash
npm install
npm start          # http://localhost:3000 (host at /host)
npm test
```

## Deploy for free on Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick this repo. `render.yaml` sets everything up on the free plan.
3. Share `https://<your-app>.onrender.com` with players and open `/host` yourself.

The free plan sleeps after 15 idle minutes and takes about a minute to wake up, so open the host page a few minutes before the meeting.
Games live in memory, so a restart or redeploy ends any game in progress. Keep your game file saved.
