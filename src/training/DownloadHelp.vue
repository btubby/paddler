<script setup>
// How a paddler gets their Strava download (the archive with activities.csv in it). Strava
// renames its menus now and then, so the steps describe what to look for as well as the names.
</script>

<template>
  <details class="help" open>
    <summary>How to get your Strava download (about 2 minutes, then a wait for an email)</summary>
    <ol>
      <li><strong>Use a computer</strong>, not the Strava phone app (the app can’t ask for the download). Go to <a href="https://www.strava.com" target="_blank" rel="noopener">strava.com</a> and log in.</li>
      <li>Click your <strong>profile picture or name</strong> at the top right, then <strong>Settings</strong>.</li>
      <li>Choose <strong>My Account</strong> in the list on the left.</li>
      <li>Near the bottom, find <strong>Download or Delete Your Account</strong> (it may just say “Download your account”) and click <strong>Get Started</strong>.</li>
      <li>Click <strong>Request Your Archive</strong> (or “Request download”).
        <span class="help__warn">Don’t click anything about deleting your account: that’s a separate step on the same page, and you don’t need it.</span></li>
      <li><strong>Wait for Strava’s email.</strong> It goes to the email address on your Strava account and usually comes within a few hours (longer if you’ve recorded a lot). Check your spam folder if it doesn’t turn up.</li>
      <li>Click the link in the email to <strong>download the zip file</strong>. It can be large (it has every GPS file you’ve recorded), so let it finish.
        <span class="help__warn">The link only works for 7 days. If you get a page of code saying “Request has expired”, it’s an old email: ask Strava for a new download (steps 1–5) and use the link in the newest email.</span></li>
      <li><strong>Drop the zip into the box below</strong>, or click the box and choose it from your Downloads folder.
        If your computer unzipped it into a folder (Safari on a Mac does), open that folder and choose the file called <strong>activities.csv</strong> instead.</li>
    </ol>
    <p class="help__more">Next time you want the charts up to date, ask Strava for a new download and drop that in. The page remembers your last one in this browser, so you only need to do it when you want newer activities.</p>
  </details>
</template>

<style scoped>
.help { margin: 12px 0 0; padding: 12px 16px; border: 1.5px solid var(--line); border-radius: 6px; background: var(--paper); }
.help summary { cursor: pointer; font-weight: 600; color: var(--heading); }
.help ol { margin: 10px 0 0; padding-left: 22px; line-height: 1.55; }
.help li { margin: 0 0 6px; }
.help a { color: var(--heading); }
.help__warn { display: block; margin-top: 2px; color: var(--clay); font-weight: 600; font-size: 0.9rem; }
.help__more { margin: 8px 0 0; font-size: 0.88rem; color: var(--muted); }
</style>
