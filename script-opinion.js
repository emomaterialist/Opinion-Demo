import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

const SUPABASE_URL = "https://mdmzwmqhlxcgcgawfibf.supabase.co";
const SUPABASE_KEY = "sb_publishable_B7VegnCeKxT_lC9pWGxxrw__KNKVZac"; // public key only, never the service_role key

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const say = (el, text) => { el.textContent = text; };

let me = null;
let embedder = null;
let lastPost = 0;

// ---- Load the AI model that turns text into 384 numbers ----
env.allowLocalModels = false;
(async () => {
  say($("model-status"), "Loading AI model (first visit downloads ~25 MB)...");
  try {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    say($("model-status"), "AI model ready.");
  } catch (e) {
    say($("model-status"), "AI model failed to load: " + e.message);
  }
})();

// ---- Accounts ----
$("signup").onclick = async () => {
  const { error } = await supabase.auth.signUp({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  say($("auth-msg"), error ? error.message : "Account created.");
};

$("login").onclick = async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  say($("auth-msg"), error ? error.message : "");
};

$("logout").onclick = () => supabase.auth.signOut();

supabase.auth.onAuthStateChange((_event, session) => {
  me = session ? session.user : null;
  $("auth-box").hidden = !!me;
  $("main").hidden = !me;
  if (me) setTimeout(loadAll, 0);
});

// ---- Post a comment ----
$("submit").onclick = async () => {
  const text = $("opinion").value.trim();
  const msg = $("post-msg");
  if (!text || text.length > 500) return say(msg, "Write between 1 and 500 characters.");
  if (Date.now() - lastPost < 10000) return say(msg, "Please wait a few seconds between posts.");
  if (!embedder) return say(msg, "The AI model is still loading. Try again in a moment.");

  $("submit").disabled = true;
  say(msg, "Posting...");
  try {
    const out = await embedder(text, { pooling: "mean", normalize: true });
    const embedding = Array.from(out.data);
    const { error } = await supabase.from("comments").insert({ text, embedding });
    if (error) throw error;
    lastPost = Date.now();
    $("opinion").value = "";
    say(msg, "Posted!");
    loadAll();
  } catch (e) {
    say(msg, "Error: " + e.message);
  } finally {
    $("submit").disabled = false;
  }
};

// ---- Show comments and votes ----
$("refresh").onclick = loadAll;

async function loadAll() {
  const [c, v] = await Promise.all([
    supabase.from("comments").select("id,user_id,text").order("created_at", { ascending: false }),
    supabase.from("votes").select("user_id,comment_id,value"),
  ]);
  if (c.error || v.error) {
    $("comments").textContent = "Error loading: " + (c.error || v.error).message;
    return;
  }

  const tally = {}; // comment_id -> { agree, disagree }
  const mine = {};  // comment_id -> my vote value
  for (const row of v.data) {
    tally[row.comment_id] ??= { agree: 0, disagree: 0 };
    if (row.value === 1) tally[row.comment_id].agree++;
    if (row.value === -1) tally[row.comment_id].disagree++;
    if (row.user_id === me.id) mine[row.comment_id] = row.value;
  }

  const box = $("comments");
  box.textContent = "";
  if (!c.data.length) box.textContent = "No opinions yet. Be the first!";

  for (const comment of c.data) {
    const card = document.createElement("div");
    card.className = "card";

    const p = document.createElement("p");
    p.textContent = comment.text; // textContent keeps typed code from running
    card.appendChild(p);

    const t = tally[comment.id] || { agree: 0, disagree: 0 };
    const counts = document.createElement("span");
    counts.className = "small";
    counts.textContent = `Agree: ${t.agree}  Disagree: ${t.disagree}  `;
    card.appendChild(counts);

    if (comment.user_id === me.id) {
      const own = document.createElement("span");
      own.className = "small";
      own.textContent = "(your comment)";
      card.appendChild(own);
    } else {
      for (const [label, value] of [["Agree", 1], ["Disagree", -1], ["Skip", 0]]) {
        const b = document.createElement("button");
        b.textContent = label;
        if (mine[comment.id] === value) b.className = "chosen";
        b.onclick = () => vote(comment.id, value);
        card.appendChild(b);
      }
    }
    box.appendChild(card);
  }
}

async function vote(commentId, value) {
  const { error } = await supabase
    .from("votes")
    .upsert({ user_id: me.id, comment_id: commentId, value }, { onConflict: "user_id,comment_id" });
  if (error) return alert(error.message);
  loadAll();
}
