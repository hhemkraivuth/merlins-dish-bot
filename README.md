# Merlin's Dish LINE Bot — Setup Guide

This turns on the automated flow we discussed: menu → cart → total →
slip check → name/address/phone → order sent to you. Follow every step
in order. None of it requires knowing how to code — you're just
creating accounts, copying and pasting keys, and clicking buttons.

Budget about 45–60 minutes for the first setup. You only do this once.

---

## What you'll end up with

- A small program ("the bot") that runs online 24/7
- It's connected to your existing LINE Official Account
- It talks to customers automatically, following the flow you designed
- Verified orders land in a private LINE chat only you see

---

## Step 1 — Create a GitHub account (holds your bot's code)

1. Go to https://github.com and sign up (free).
2. Once logged in, click the **+** icon top-right → **New repository**.
3. Name it `merlins-dish-bot`. Keep it **Private**. Click **Create repository**.
4. On the new repo page, click **uploading an existing file**.
5. Drag in all the files from this bot (`server.js`, `menu.js`,
   `sheetLogger.js`, `package.json`, `.env.example`, `README.md`).
   Do **not** upload a `.env` file with real secrets in it — those go
   into Railway directly in Step 6, never into GitHub.
6. Click **Commit changes**.

---

## Step 2 — Create your LINE Messaging API channel

This is different from the LINE Official Account Manager you already
use for broadcasts — it's what lets code talk to your OA.

1. Go to https://developers.line.biz/console/ and log in with the
   same LINE account that manages your Merlin's Dish OA.
2. Create a **Provider** if you don't have one (any name, e.g. "Merlin's Dish").
3. Inside that provider, click **Create a new channel** → **Messaging API**.
4. Fill in the basic details (name, description, category — pick "Food & Drink").
5. Once created, open the channel and go to the **Messaging API** tab.
6. Scroll to **Channel access token** → click **Issue**. Copy this
   long string somewhere safe — this is `LINE_CHANNEL_ACCESS_TOKEN`.
7. Go to the **Basic settings** tab → copy the **Channel secret** —
   this is `LINE_CHANNEL_SECRET`.
8. Back in **Messaging API** tab, turn **OFF** "Auto-reply messages"
   and "Greeting messages" (the bot handles these now). Turn **ON**
   "Use webhook".

---

## Step 3 — Get your Thunder Solution slip-check API key

1. Go to https://panel.thunder.in.th/sign-up and create a free account.
2. Once logged in, find your **API Key** in the dashboard (may be
   under "Applications" or "API Keys").
3. Copy it — this is `THUNDER_API_KEY`.
4. You'll start on the free tier (150 slip checks/month). No card
   needed yet. Upgrade later only if you outgrow it.

---

## Step 4 — Set your payment info text

Open `server.js` in GitHub (click the file, then the pencil/edit
icon) and find this line:

```
const paymentInfo = process.env.BUSINESS_PAYMENT_INFO || "our PromptPay QR";
```

You don't need to edit this file — instead you'll set
`BUSINESS_PAYMENT_INFO` as a variable in Step 6 (e.g. `"PromptPay
012-345-6789 (Merlin's Dish)"`). This is just showing you where it's
used.

---

## Step 5 — Deploy the bot to Railway

Railway runs your bot online so it works even when your phone is off.

1. Go to https://railway.app and sign up using your GitHub account.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Choose `merlins-dish-bot`.
4. Railway will detect it's a Node.js app and start building
   automatically. This first build will likely **fail** — that's
   expected, because it's missing the secret keys. Continue to Step 6.

---

## Step 6 — Add your secret keys to Railway

1. In your Railway project, click your service, then the
   **Variables** tab.
2. Add each of these one at a time (click **New Variable**):

   | Variable name | Value |
   |---|---|
   | `LINE_CHANNEL_ACCESS_TOKEN` | from Step 2.6 |
   | `LINE_CHANNEL_SECRET` | from Step 2.7 |
   | `THUNDER_API_KEY` | from Step 3.3 |
   | `BUSINESS_PAYMENT_INFO` | e.g. `PromptPay 012-345-6789 (Merlin's Dish)` |
   | `LINE_INTERNAL_TARGET_ID` | leave blank for now — Step 8 |

3. Click **Deploy** (or it redeploys automatically). Wait for the
   status to turn green ("Active").
4. Click into the service → **Settings** → **Networking** → **Generate
   Domain**. You'll get a URL like
   `https://merlins-dish-bot-production.up.railway.app`. Copy it.

---

## Step 7 — Connect LINE to your bot

1. Back in the LINE Developers Console, open your channel →
   **Messaging API** tab.
2. Find **Webhook URL** → click **Edit** → paste your Railway URL
   with `/webhook` on the end, e.g.
   `https://merlins-dish-bot-production.up.railway.app/webhook`
3. Click **Update**, then click **Verify** — it should say Success.
   If it fails, double check the Railway deployment is "Active" and
   the URL ends in `/webhook`.

---

## Step 8 — Find your internal notification target

This is where finished orders get sent — just to you, privately.

1. In LINE, create a new group chat with just yourself (or you + any
   staff), e.g. "Merlin's Dish Orders".
2. Add your bot to that group: in LINE Developers Console →
   **Messaging API** tab, scroll to **QR code** and scan it with the
   LINE app to add the bot as a friend, then invite it into your new
   group chat the same way you'd invite any contact.
3. Send any message in that group (e.g. "hi").
4. In Railway, open your service → **Deployments** → click the active
   deployment → **View Logs**. Look for a line like:
   `Event from source: {"type":"group","groupId":"C1234567890abcdef...","userId":"..."}`
5. Copy the `groupId` value (including the `C` at the start).
6. Go back to Railway → **Variables** → set `LINE_INTERNAL_TARGET_ID`
   to that value. Redeploy.

---

## Step 8b — Set your shop coordinates (for free delivery under 2km)

1. Open Google Maps, find your Asok location, right-click it.
2. Click the coordinates at the top of the menu that appears -- this
   copies them (e.g. `13.7369, 100.5606`).
3. In Railway → Variables, set `SHOP_LAT` to the first number and
   `SHOP_LNG` to the second number.

## Step 8c — Set your own admin ID (for sold-out commands)

1. Message your bot from your own personal LINE account (any text).
2. In Railway → Logs, find the line with your event and copy the
   `userId` value (same method as Step 8).
3. Set `ADMIN_USER_ID` in Railway to that value. Redeploy.
4. Test it: text your bot **"stock"** from that same account. It
   should reply with a list of every dish and whether it's sold out.
   Text **"soldout rws_r"** (or any item id shown) to hide it from
   customers, and **"instock rws_r"** to bring it back.

## Step 9 — Set up your rich menu to open the bot

You likely already have a rich menu from before. Edit it so the
"order" button uses this action:

- **Action type:** Text
- **Text:** `menu`

That's it — no code needed for this part. When tapped, it sends the
word "menu" as if the customer typed it, which the bot recognises and
replies with the ordering buttons.

---

## Step 10 — Test it yourself before going live

1. Open a chat with your OA from a personal LINE account (not the
   business one).
2. Tap your rich menu button (or type "menu").
3. Tap a couple of dishes, tap Checkout, tap Confirm.
4. Transfer a small real amount to yourself (or use a slip from a
   past real transfer) and send that photo.
5. If verified, answer the name/address/phone prompts.
6. When the bot asks for your delivery location, try both ways:
   share a real location pin near your shop (should say "free
   delivery"), and separately test one further than 2km away (should
   ping your private group asking you to set a fee).
7. Check your private "Merlin's Dish Orders" group — you should see
   the full order appear there, including the delivery fee note.

If the slip check fails unexpectedly, check Railway's **Logs** tab
for the error message.

---

## Ongoing: how to make changes yourself

**Change a price or add/remove a dish**
Go to your GitHub repo → open `menu.js` → click the pencil (edit)
icon → change the line → **Commit changes**. Railway redeploys
automatically within a minute or two.

**Change your payment details**
Railway → Variables → edit `BUSINESS_PAYMENT_INFO` → redeploy.

**See what's happening / debug a problem**
Railway → your service → **Logs** tab shows everything happening in
real time.

---

## What this costs you

| Item | Cost |
|---|---|
| LINE Messaging API | Free (replies to customers never cost anything; only the order summary to your private group counts toward a monthly free quota, which is generous) |
| Thunder Solution slip checks | Free for the first 150/month, then ~฿99/month for 400 |
| Railway hosting | Free tier usually covers this; otherwise a few hundred baht/month at most |

---

## Sold-out items

Text the bot directly from your own LINE account (the one set as
`ADMIN_USER_ID`):
- `stock` — see what's currently marked sold out
- `soldout <item_id>` — hide a dish from customers (e.g. `soldout rws_r`)
- `instock <item_id>` — bring it back

Item ids are the short codes on the left of each line in `menu.js`.
This is separate from Grab — you'll still mark items out of stock on
Grab's own app by hand, there's no self-serve API to connect the two.

## Free delivery under 2km

When the customer shares their LINE location, the bot calculates the
straight-line distance from your shop (set in `SHOP_LAT`/`SHOP_LNG`)
and waives the fee automatically under 2km. Past that, it pings your
private group right away with the distance so you can work out a fee
while the rest of the order is still being collected, and flags it
again on the final order summary. If a customer types their address
instead of sharing a pin, distance can't be calculated, so it's
always flagged as manual in that case.

## What this bot does NOT do (yet)

- If Railway restarts (rare), any order that's mid-conversation is
  lost and the customer has to start over. Finished orders already
  sent to your group are unaffected. The sold-out list also resets on
  restart -- re-mark anything that was out of stock if that happens.
- Google Sheet logging is optional and off by default. If you want
  it, tell me and I'll walk you through the extra setup — it needs a
  Google "service account," which is a few more steps.
- It doesn't call a rider for you yet. Grab Express has an API, but
  like the stock API it's only open to approved partners, not
  something you can self-register for. Lalamove runs an actual
  self-serve Partner Portal with free API access, so once this
  ordering flow is running smoothly, that's the realistic next step
  for automating dispatch. It needs its own Lalamove Business account
  first, so it's worth treating as a separate phase rather than
  bolting on today.

If anything breaks or behaves oddly, copy the error text from
Railway's Logs tab and send it to me — I'll tell you exactly what to
fix.
