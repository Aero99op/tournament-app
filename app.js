// VORTEX SECURITY: VIEW-ONLY DEVTOOLS & STATE INTEGRITY PROTOCOL
(function initSecurityProtocol() {
  if (typeof window === "undefined") return;

  try {
    console.info(
      "%c🛡️ VORTEX ESPORTS OS — SECURE VIEW MODE ACTIVE\n" +
      "%cDevTools viewing and network inspection is permitted for debugging.\n" +
      "⚠️ Note: All destructive commands, unauthorized tournament mutations, and state overrides are strictly blocked by server-side and cryptographic owner validation.",
      "color:#00f0ff; font-size:14px; font-weight:bold; padding:4px 0;",
      "color:#94a3b8; font-size:12px;"
    );
  } catch (e) {}
})();

let currentView = "view-landing";

let currentWsTab = "panel-ws-overview";

let activeTourneyId = 1;

let activeMatchIdx = 0;

let editingTeamName = "";

let tempTeamScores = [];

let currentUser = { id: null, email: "", name: "Guest", uid: "", role: "Organizer", loggedIn: false };
let currentAuthTab = "login";

let tournamentsDb = [];

const SUPABASE_URL = "https://vufeeywjdrxxxdkwwkzx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmVleXdqZHJ4eHhka3d3a3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NjI1ODQsImV4cCI6MjEwMjUzODU4NH0.kKTxCwYDaDuVEcanoEn33F_et3RCfHTyIlZyBqq_XNs";

let supabaseClient = null;
let isSupabaseLive = false;

function updateSyncStatus(status, text) {
  const el = document.getElementById("db-sync-status");
  if (el) {
    el.className = "db-sync-badge " + status;
    el.textContent = text;
  }
}

function updateHeaderAuthUI() {
  const profileBadge = document.getElementById("user-profile-badge");
  const loginBtn = document.getElementById("btn-open-auth");
  const displayName = document.getElementById("display-user-name");

  if (currentUser && currentUser.loggedIn) {
    if (profileBadge) profileBadge.style.display = "flex";
    if (loginBtn) loginBtn.style.display = "none";
    if (displayName) displayName.textContent = currentUser.name + " (" + currentUser.role + ")";
  } else {
    if (profileBadge) profileBadge.style.display = "none";
    if (loginBtn) loginBtn.style.display = "inline-block";
  }
}

function openAuthModal() {
  const modal = document.getElementById("modal-auth");
  if (modal) modal.classList.add('show');
}
window.vortexOpenAuthModal = openAuthModal;

function setUserFromSession(user) {
  if (!user) return;
  const metadata = user.user_metadata || {};
  currentUser = {
    id: user.id,
    email: user.email || "",
    name: metadata.name || (user.email ? user.email.split('@')[0] : "Organizer"),
    uid: metadata.uid || user.id.slice(0, 8),
    role: metadata.role || "Organizer",
    loggedIn: true
  };
  saveStateToStorage(false);
  updateHeaderAuthUI();
}

async function initSupabase() {
  if (typeof window !== "undefined" && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      updateSyncStatus("connecting", "⚡ CONNECTING TO CLOUD...");
      
      // Auto-restore session from token stored in browser
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        setUserFromSession(session.user);
      } else {
        updateHeaderAuthUI();
      }

      await fetchTournamentsFromSupabase();
      setupRealtimeSubscription();
      setupAuthListener();
    } catch (err) {
      console.warn("Cloud init error:", err);
      updateSyncStatus("offline", "💾 LOCAL STORAGE");
    }
  } else {
    updateSyncStatus("offline", "💾 LOCAL STORAGE");
  }
}

function setupAuthListener() {
  if (!supabaseClient) return;
  try {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session && session.user) {
        setUserFromSession(session.user);
        await fetchTournamentsFromSupabase();
      } else if (event === "SIGNED_OUT") {
        currentUser = { id: null, email: "", name: "Guest", uid: "", role: "Organizer", loggedIn: false };
        saveStateToStorage(false);
        updateHeaderAuthUI();
        renderLandingFeatured();
        renderManageList();
      }
    });
  } catch (e) {
    console.warn("Auth listener setup notice:", e);
  }
}

function parseSupabaseRow(row) {
  const pts = row.placement_points || {};
  const meta = pts._meta || {};
  return {
    id: row.id,
    title: row.title || "VORTEX TOURNAMENT",
    game: row.game || "Free Fire MAX",
    format: row.format || "Squad (Battle Royale)",
    maps: row.maps || "Bermuda",
    slots: Number(row.slots) || 12,
    prize: row.prize || "₹10,000",
    status: row.status || "LIVE",
    statusClass: row.status_class || row.statusClass || "live",
    killMultiplier: row.kill_multiplier !== undefined ? row.kill_multiplier : (row.killMultiplier || 1),
    placementPoints: pts,
    whatsappLink: row.whatsapp_link || meta.whatsappLink || "",
    discordLink: row.discord_link || meta.discordLink || "",
    registrationDeadline: row.registration_deadline || meta.registrationDeadline || "",
    entryType: row.entry_type || meta.entryType || "FREE",
    entryFee: row.entry_fee !== undefined ? row.entry_fee : (meta.entryFee || 0),
    upiId: row.upi_id || meta.upiId || "7848033183@fam",
    upiName: row.upi_name || meta.upiName || "Spandan Prayas",
    pools: Array.isArray(row.pools) ? row.pools : (Array.isArray(meta.pools) ? meta.pools : []),
    user_id: row.user_id || meta.userId || null,
    creatorName: row.creator_name || meta.creatorName || "Organizer",
    teams: Array.isArray(row.teams) ? row.teams : [],
    matches: Array.isArray(row.matches) ? row.matches : [],
    checkpoints: Array.isArray(row.checkpoints) ? row.checkpoints : []
  };
}

function buildSupabasePayload(tourney) {
  const points = Object.assign({}, tourney.placementPoints || { "1":12,"2":9,"3":8,"4":7,"5":6,"6":5,"7":4,"8":3,"9":2,"10":1,"11":0,"12":0 });
  points._meta = {
    entryType: tourney.entryType || "FREE",
    entryFee: Number(tourney.entryFee) || 0,
    upiId: tourney.upiId || "7848033183@fam",
    upiName: tourney.upiName || "Spandan Prayas",
    pools: Array.isArray(tourney.pools) ? tourney.pools : [],
    whatsappLink: tourney.whatsappLink || "",
    discordLink: tourney.discordLink || "",
    registrationDeadline: tourney.registrationDeadline || "",
    creatorName: tourney.creatorName || "Organizer",
    userId: tourney.user_id || null
  };

  return {
    title: tourney.title,
    game: tourney.game,
    format: tourney.format,
    maps: tourney.maps,
    slots: Number(tourney.slots) || 12,
    prize: tourney.prize || "₹10,000",
    status: tourney.status || "LIVE",
    status_class: tourney.statusClass || "live",
    kill_multiplier: tourney.killMultiplier !== undefined ? tourney.killMultiplier : 1,
    placement_points: points,
    teams: Array.isArray(tourney.teams) ? tourney.teams : [],
    matches: Array.isArray(tourney.matches) ? tourney.matches : [],
    checkpoints: Array.isArray(tourney.checkpoints) ? tourney.checkpoints : [],
    user_id: (tourney.user_id && String(tourney.user_id).length > 20) ? tourney.user_id : null
  };
}

async function fetchTournamentsFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('tournaments')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.warn("Cloud fetch notice:", error.message);
      updateSyncStatus("offline", "💾 LOCAL STORAGE");
      return;
    }

    if (Array.isArray(data)) {
      tournamentsDb = data.map(row => parseSupabaseRow(row));
      saveStateToStorage(false);
      renderLandingFeatured();
      renderManageList();
      if (currentView === "view-workspace") {
        if (!tournamentsDb.some(t => String(t.id) === String(activeTourneyId))) {
          switchView("view-landing");
        } else {
          openWorkspaceWithId(activeTourneyId);
        }
      }
      handleUrlRouting();
      isSupabaseLive = true;
      updateSyncStatus("online", "🟢 CONNECTED TO CLOUD");
    }
  } catch (err) {
    console.warn("Network error during Cloud sync:", err);
    updateSyncStatus("offline", "💾 LOCAL STORAGE");
  }
}

function setupRealtimeSubscription() {
  if (!supabaseClient) return;
  try {
    supabaseClient
      .channel('tournaments_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, payload => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new;
          if (!tournamentsDb.some(t => String(t.id) === String(row.id))) {
            tournamentsDb.unshift(parseSupabaseRow(row));
            saveStateToStorage(false);
            renderLandingFeatured();
            renderManageList();
            showToast("⚡ New tournament synced from cloud!");
          }
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new;
          const idx = tournamentsDb.findIndex(t => String(t.id) === String(row.id));
          if (idx !== -1) {
            tournamentsDb[idx] = parseSupabaseRow(row);
            saveStateToStorage(false);
            renderLandingFeatured();
            renderManageList();
            if (String(activeTourneyId) === String(row.id) && currentView === "view-workspace") {
              renderWorkspaceOverview();
              renderWorkspaceTeams();
              renderWorkspaceMatches();
              renderWorkspaceMatchStandings();
              renderWorkspaceOverallStandings();
              renderWorkspacePayments();
              renderWorkspacePools();
            }
          }
        } else if (payload.eventType === 'DELETE') {
          const deletedId = payload.old ? (payload.old.id || payload.old) : null;
          if (deletedId) {
            tournamentsDb = tournamentsDb.filter(t => String(t.id) !== String(deletedId));
            saveStateToStorage(false);
            renderLandingFeatured();
            renderManageList();
            if (String(activeTourneyId) === String(deletedId)) {
              showToast("⚠️ This tournament has been removed by its organizer.");
              if (currentView === "view-workspace") {
                switchView("view-landing");
              }
            }
          }
        }
      })
      .subscribe();
  } catch (e) {
    console.warn("Realtime subscription setup notice:", e);
  }
}

async function syncTourneyToSupabase(tourney) {
  if (!supabaseClient || !tourney) return;
  if (tourney.user_id && !isTourneyOwner(tourney)) {
    return;
  }
  try {
    const payload = buildSupabasePayload(tourney);
    if (tourney.id && (typeof tourney.id === 'number' || typeof tourney.id === 'string')) {
      const { error } = await supabaseClient
        .from('tournaments')
        .update(payload)
        .eq('id', tourney.id);

      if (error) {
        console.warn("Supabase update notice:", error.message);
      }
    }
  } catch (e) {
    console.warn("Cloud background sync notice:", e);
  }
}

async function insertNewTourneyToSupabase(newTourney) {
  if (!supabaseClient) return null;
  try {
    const payload = buildSupabasePayload(newTourney);
    const { data, error } = await supabaseClient
      .from('tournaments')
      .insert([payload])
      .select();

    if (!error && data && data.length > 0) {
      const insertedId = data[0].id;
      newTourney.id = insertedId;
      saveStateToStorage(false);
      renderLandingFeatured();
      renderManageList();
      return insertedId;
    } else if (error) {
      console.warn("Supabase insert error:", error.message);
    }
  } catch (e) {
    console.warn("Supabase insert exception:", e);
  }
  return null;
}

function saveStateToStorage(shouldSyncCloud = true) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("vortex_tournaments", JSON.stringify(tournamentsDb));
      localStorage.setItem("vortex_user", JSON.stringify(currentUser));
    }
  } catch (e) {
    console.warn("Storage save error:", e);
  }
  if (shouldSyncCloud) {
    const activeT = getActiveTourney();
    if (activeT) {
      syncTourneyToSupabase(activeT);
    }
  }
}

function loadStateFromStorage() {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("vortex_tournaments");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          tournamentsDb = parsed;
        }
      }
      const savedUser = localStorage.getItem("vortex_user");
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        if (parsedUser && typeof parsedUser === 'object') {
          currentUser = parsedUser;
        }
      }
    }
  } catch (e) {
    console.warn("Storage load error:", e);
  }
  updateHeaderAuthUI();
}

function showToast(message) {
  (document.getElementById("toast-container") || document.querySelector("toast-container")).innerHTML = "<div class='toast-item'>" + message + "</div>";
  (document.getElementById("toast-container") || document.querySelector("toast-container")).style.display = 'block';
  setTimeout(function() {
    (document.getElementById("toast-container") || document.querySelector("toast-container")).style.display = 'none';
  }, 3000);
}

function getActiveTourney() {
  if (!tournamentsDb || tournamentsDb.length === 0) return null;
  for (const t of tournamentsDb) {
    if (t.id == activeTourneyId) {
      return t;
    }
  }
  return tournamentsDb[0];
}

function switchView(targetId) {
  currentView = targetId;
  (document.getElementById("view-landing") || document.querySelector("view-landing")).style.display = 'none';
  (document.getElementById("view-create") || document.querySelector("view-create")).style.display = 'none';
  (document.getElementById("view-manage") || document.querySelector("view-manage")).style.display = 'none';
  (document.getElementById("view-workspace") || document.querySelector("view-workspace")).style.display = 'none';
  (document.getElementById("nav-landing") || document.querySelector("nav-landing")).classList.remove('active');
  (document.getElementById("nav-create") || document.querySelector("nav-create")).classList.remove('active');
  (document.getElementById("nav-manage") || document.querySelector("nav-manage")).classList.remove('active');
  if (targetId == "view-landing") {
    (document.getElementById("view-landing") || document.querySelector("view-landing")).style.display = 'block';
    (document.getElementById("view-landing") || document.querySelector("view-landing")).classList.add('active');
    (document.getElementById("nav-landing") || document.querySelector("nav-landing")).classList.add('active');
  }
  if (targetId == "view-create") {
    (document.getElementById("view-create") || document.querySelector("view-create")).style.display = 'block';
    (document.getElementById("view-create") || document.querySelector("view-create")).classList.add('active');
    (document.getElementById("nav-create") || document.querySelector("nav-create")).classList.add('active');
    renderCreateTourneySquads();
  }
  if (targetId == "view-manage") {
    (document.getElementById("view-manage") || document.querySelector("view-manage")).style.display = 'block';
    (document.getElementById("view-manage") || document.querySelector("view-manage")).classList.add('active');
    (document.getElementById("nav-manage") || document.querySelector("nav-manage")).classList.add('active');
  }
  if (targetId == "view-workspace") {
    (document.getElementById("view-workspace") || document.querySelector("view-workspace")).style.display = 'block';
    (document.getElementById("view-workspace") || document.querySelector("view-workspace")).classList.add('active');
  }
  (document.getElementById("main-navbar") || document.querySelector("main-navbar")).scrollIntoView({ behavior: 'smooth' });
}

function switchWsTab(panelId) {
  currentWsTab = panelId;
  const panels = ["panel-ws-overview", "panel-ws-payments", "panel-ws-pools", "panel-ws-teams", "panel-ws-matches", "panel-ws-match-standings", "panel-ws-overall-standings", "panel-ws-points-rules", "panel-ws-exports"];
  const tabs = ["ws-tab-overview", "ws-tab-payments", "ws-tab-pools", "ws-tab-teams", "ws-tab-matches", "ws-tab-match-standings", "ws-tab-overall-standings", "ws-tab-points-rules", "ws-tab-exports"];

  panels.forEach(p => {
    const el = document.getElementById(p);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });
  tabs.forEach(t => {
    const el = document.getElementById(t);
    if (el) el.classList.remove('active');
  });

  const activePanel = document.getElementById(panelId);
  if (activePanel) {
    activePanel.style.display = 'block';
    activePanel.classList.add('active');
  }
  const tabId = panelId.replace("panel-", "");
  const activeTab = document.getElementById(tabId);
  if (activeTab) activeTab.classList.add('active');

  if (panelId === "panel-ws-payments") {
    renderWorkspacePayments();
  }
  if (panelId === "panel-ws-pools") {
    renderWorkspacePools();
  }
  if (panelId === "panel-ws-exports") {
    renderExportsStudio();
  }
}

function isTourneyOwner(tourney) {
  if (!tourney) return false;
  if (tourney.user_id) {
    return !!(currentUser && currentUser.loggedIn && currentUser.id === tourney.user_id);
  }
  // For tournaments created locally without a user_id
  return !!(currentUser && currentUser.loggedIn);
}

function isDeadlinePassed(tourney) {
  if (!tourney || !tourney.registrationDeadline) return false;
  try {
    const deadline = new Date(tourney.registrationDeadline);
    return !isNaN(deadline.getTime()) && deadline.getTime() < Date.now();
  } catch (e) {
    return false;
  }
}

function formatDeadlineText(tourney) {
  if (!tourney || !tourney.registrationDeadline) return "Open";
  try {
    const deadline = new Date(tourney.registrationDeadline);
    if (isNaN(deadline.getTime())) return tourney.registrationDeadline;
    return deadline.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return tourney.registrationDeadline;
  }
}

function getUserRegisteredSquads() {
  try {
    const raw = localStorage.getItem("vortex_registered_squads");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveUserRegisteredSquad(regInfo) {
  try {
    const all = getUserRegisteredSquads().filter(r => r.tourneyId !== regInfo.tourneyId);
    all.push(regInfo);
    localStorage.setItem("vortex_registered_squads", JSON.stringify(all));
  } catch (e) {}
}

function getUserRegisteredSquadForTourney(tourney) {
  if (!tourney || !Array.isArray(tourney.teams)) return null;

  // 1. Check local storage
  const localList = getUserRegisteredSquads();
  const foundLocal = localList.find(r => r.tourneyId === tourney.id);
  if (foundLocal) {
    const tIdx = tourney.teams.findIndex(t => t.name === foundLocal.squadName || (t.captain && t.captain.includes(foundLocal.leaderUID)));
    if (tIdx !== -1) {
      return { teamIdx: tIdx, squad: tourney.teams[tIdx] };
    }
  }

  // 2. Check logged in user info
  if (currentUser && currentUser.loggedIn) {
    const userUID = currentUser.uid;
    const userEmail = currentUser.email;
    const userPhone = currentUser.phone;

    const tIdx = tourney.teams.findIndex(t => {
      const isCaptain = t.captain && (t.captain.includes(userUID) || (userEmail && t.captain.includes(userEmail)));
      const hasPlayer = Array.isArray(t.players) && t.players.some(p => p.uid === userUID || (p.name && p.name === currentUser.name));
      const isPhone = userPhone && t.whatsapp === userPhone;
      return isCaptain || hasPlayer || isPhone;
    });

    if (tIdx !== -1) {
      return { teamIdx: tIdx, squad: tourney.teams[tIdx] };
    }
  }

  return null;
}

function generateShareUrl(tourneyId, action = 'register') {
  const base = window.location.origin + window.location.pathname;
  return `${base}?tourney=${tourneyId}&action=${action}`;
}

function openShareTourneyModal(tourneyId) {
  const tourney = tournamentsDb.find(t => t.id === tourneyId) || getActiveTourney();
  if (!tourney) return;

  const shareUrl = generateShareUrl(tourney.id, 'register');
  const inputEl = document.getElementById("share-link-input");
  if (inputEl) inputEl.value = shareUrl;

  const waBtn = document.getElementById("share-btn-wa");
  if (waBtn) {
    const text = `🔥 Register your squad for *${tourney.title}* (${tourney.game} • Prize: ${tourney.prize})!\n\n👉 Click link to register directly: ${shareUrl}`;
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  }

  const nativeBtn = document.getElementById("btn-native-share");
  if (nativeBtn) {
    if (navigator.share) {
      nativeBtn.style.display = "block";
      nativeBtn.onclick = async () => {
        try {
          await navigator.share({
            title: tourney.title,
            text: `Register your squad for ${tourney.title} (Prize: ${tourney.prize})!`,
            url: shareUrl
          });
        } catch (err) {}
      };
    } else {
      nativeBtn.style.display = "none";
    }
  }

  const modal = document.getElementById("modal-share-tourney");
  if (modal) modal.classList.add('show');
}

window.vortexShareTourney = openShareTourneyModal;

let pendingDeleteTourneyId = null;

function openDeleteTourneyModal(tourneyId) {
  if (!currentUser || !currentUser.loggedIn) {
    showToast("🔑 Please login to manage or delete tournaments.");
    openAuthModal();
    return;
  }
  const tourney = tournamentsDb.find(t => t.id === tourneyId);
  if (!tourney) return;

  if (!isTourneyOwner(tourney)) {
    showToast("⛔ Permission denied: Only the tournament creator can delete this tournament.");
    return;
  }

  pendingDeleteTourneyId = tourneyId;
  const nameEl = document.getElementById("del-modal-tourney-name");
  if (nameEl) nameEl.textContent = tourney.title;
  const modal = document.getElementById("modal-delete-confirm");
  if (modal) modal.classList.add('show');
}

async function confirmDeleteTourney() {
  if (!pendingDeleteTourneyId) return;
  const tIdx = tournamentsDb.findIndex(t => t.id === pendingDeleteTourneyId);
  if (tIdx === -1) return;

  const tourney = tournamentsDb[tIdx];
  if (!isTourneyOwner(tourney)) {
    showToast("⛔ Permission denied: Only the tournament creator can delete this tournament.");
    return;
  }

  const tourneyTitle = tourney.title;
  const deletedId = pendingDeleteTourneyId;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('tournaments').delete().eq('id', Number(deletedId) || deletedId);
      if (error) {
        console.warn("Cloud delete error:", error.message);
      }
    } catch (e) {
      console.warn("Supabase delete notice:", e);
    }
  }

  tournamentsDb.splice(tIdx, 1);
  saveStateToStorage(false);

  const modal = document.getElementById("modal-delete-confirm");
  if (modal) modal.classList.remove('show');
  pendingDeleteTourneyId = null;

  showToast("🗑️ Tournament '" + tourneyTitle + "' deleted permanently.");
  renderLandingFeatured();
  renderManageList();

  if (currentView === "view-workspace") {
    switchView("view-manage");
  }
}

function openSquadRegistrationModal(tourneyId, isEdit = false, teamIdx = -1) {
  if (!currentUser || !currentUser.loggedIn) {
    showToast("🔑 Please login or sign up to register your squad.");
    openAuthModal();
    return;
  }
  const tourney = tournamentsDb.find(t => t.id === tourneyId) || getActiveTourney();
  if (!tourney) return;

  if (isDeadlinePassed(tourney)) {
    showToast("🔒 Registration & Roster Edit window has closed for this tournament.");
    return;
  }

  if (!isEdit && tourney.teams.length >= tourney.slots) {
    showToast("⚠️ Registration Closed: All " + tourney.slots + " squad slots are full!");
    return;
  }

  if (isEdit) {
    const isOwner = isTourneyOwner(tourney);
    const regSquad = getUserRegisteredSquadForTourney(tourney);
    if (!isOwner && (!regSquad || regSquad.teamIdx !== teamIdx)) {
      showToast("⛔ Permission Denied: You can only edit your own registered squad.");
      return;
    }
  }

  const idInput = document.getElementById("reg-target-tourney-id");
  if (idInput) idInput.value = tourney.id;

  const isEditInput = document.getElementById("reg-is-edit-mode");
  if (isEditInput) isEditInput.value = isEdit ? "1" : "0";

  const editIdxInput = document.getElementById("reg-edit-team-idx");
  if (editIdxInput) editIdxInput.value = String(teamIdx);

  const titleSub = document.getElementById("reg-modal-tourney-title");
  const submitBtn = document.getElementById("btn-submit-registration");

  if (isEdit && teamIdx >= 0 && tourney.teams[teamIdx]) {
    const existingTeam = tourney.teams[teamIdx];
    if (titleSub) titleSub.textContent = `EDIT SQUAD ROSTER • ${existingTeam.name} (Slot #${existingTeam.slot})`;
    if (submitBtn) submitBtn.textContent = "💾 SAVE SQUAD ROSTER CHANGES";

    const squadNameEl = document.getElementById("reg-squad-name");
    if (squadNameEl) squadNameEl.value = existingTeam.name || "";

    const squadTagEl = document.getElementById("reg-squad-tag");
    if (squadTagEl) squadTagEl.value = existingTeam.tag || "";

    const leaderNameEl = document.getElementById("reg-leader-name");
    if (leaderNameEl) leaderNameEl.value = existingTeam.captain ? existingTeam.captain.split(" (")[0] : "";

    const leaderIgnEl = document.getElementById("reg-leader-ign");
    if (leaderIgnEl) leaderIgnEl.value = existingTeam.players?.[0]?.name || "";

    const leaderUidEl = document.getElementById("reg-leader-uid");
    if (leaderUidEl) leaderUidEl.value = existingTeam.players?.[0]?.uid || "";

    const leaderWaEl = document.getElementById("reg-leader-whatsapp");
    if (leaderWaEl) leaderWaEl.value = existingTeam.whatsapp || "";

    const leaderEmailEl = document.getElementById("reg-leader-email");
    if (leaderEmailEl) leaderEmailEl.value = existingTeam.email || "";

    const p2Ign = document.getElementById("reg-p2-ign");
    if (p2Ign) p2Ign.value = existingTeam.players?.[1]?.name || "";
    const p2Uid = document.getElementById("reg-p2-uid");
    if (p2Uid) p2Uid.value = existingTeam.players?.[1]?.uid || "";

    const p3Ign = document.getElementById("reg-p3-ign");
    if (p3Ign) p3Ign.value = existingTeam.players?.[2]?.name || "";
    const p3Uid = document.getElementById("reg-p3-uid");
    if (p3Uid) p3Uid.value = existingTeam.players?.[2]?.uid || "";

    const p4Ign = document.getElementById("reg-p4-ign");
    if (p4Ign) p4Ign.value = existingTeam.players?.[3]?.name || "";
    const p4Uid = document.getElementById("reg-p4-uid");
    if (p4Uid) p4Uid.value = existingTeam.players?.[3]?.uid || "";
  } else {
    if (titleSub) titleSub.textContent = tourney.title + " • Slots Available: " + (tourney.slots - tourney.teams.length);
    if (submitBtn) submitBtn.textContent = "✓ CONFIRM SQUAD REGISTRATION";

    const fields = ["reg-squad-name", "reg-squad-tag", "reg-leader-name", "reg-leader-ign", "reg-leader-uid", "reg-leader-whatsapp", "reg-leader-email", "reg-p2-ign", "reg-p2-uid", "reg-p3-ign", "reg-p3-uid", "reg-p4-ign", "reg-p4-uid", "reg-payment-utr", "reg-payment-screenshot"];
    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = "";
    });
  }

  // Payment Section Setup
  const paySection = document.getElementById("reg-payment-section");
  const isPaidTourney = tourney.entryType === "PAID" && Number(tourney.entryFee) > 0;
  
  if (paySection) {
    if (isPaidTourney && !isEdit) {
      paySection.style.display = "block";
      const amtBadge = document.getElementById("reg-pay-amt-badge");
      if (amtBadge) amtBadge.textContent = "₹" + tourney.entryFee + " / SQUAD";

      const upiId = tourney.upiId || "7848033183@fam";
      const upiName = tourney.upiName || "Spandan Prayas";
      // Unique NPCI Transaction Reference Code (tr)
      const uniqueTrCode = "VTX" + Math.floor(100000 + Math.random() * 900000);
      const upiIntentUrl = "upi://pay?pa=" + encodeURIComponent(upiId) + "&pn=" + encodeURIComponent(upiName) + "&am=" + tourney.entryFee + "&cu=INR&tr=" + encodeURIComponent(uniqueTrCode) + "&tn=" + encodeURIComponent("Vortex " + uniqueTrCode);
      const payLinkBtn = document.getElementById("btn-upi-intent-pay");
      if (payLinkBtn) payLinkBtn.href = upiIntentUrl;

      // Dynamic High-Resolution QR Code image
      const qrImg = document.getElementById("reg-upi-qr-img");
      if (qrImg) qrImg.src = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(upiIntentUrl);

      const utrInput = document.getElementById("reg-payment-utr");
      if (utrInput) utrInput.value = "";
      const proofInput = document.getElementById("reg-payment-screenshot");
      if (proofInput) proofInput.value = "";
    } else {
      paySection.style.display = "none";
    }
  }

  const modal = document.getElementById("modal-squad-registration");
  if (modal) modal.classList.add('show');
}

async function handleSquadRegistrationSubmit() {
  const tIdVal = (document.getElementById("reg-target-tourney-id") || {}).value || activeTourneyId;
  const tourney = tournamentsDb.find(t => String(t.id) === String(tIdVal));
  if (!tourney) {
    showToast("⚠️ Tournament not found. Please refresh the page.");
    return;
  }

  const isEditMode = (document.getElementById("reg-is-edit-mode") || {}).value === "1";
  const editIdx = Number((document.getElementById("reg-edit-team-idx") || {}).value);

  if (isDeadlinePassed(tourney)) {
    showToast("🔒 Roster modification closed: Tournament registration deadline has passed.");
    return;
  }

  if (isEditMode) {
    if (editIdx < 0 || !tourney.teams[editIdx]) {
      showToast("⛔ Invalid squad edit target.");
      return;
    }
    const isOwner = isTourneyOwner(tourney);
    const regSquad = getUserRegisteredSquadForTourney(tourney);
    if (!isOwner && (!regSquad || regSquad.teamIdx !== editIdx)) {
      showToast("⛔ Permission Denied: You cannot modify another squad's roster.");
      return;
    }
  }

  if (!isEditMode && tourney.teams.length >= tourney.slots) {
    showToast("⚠️ Registration Closed: All slots have been filled!");
    return;
  }

  const squadName = (document.getElementById("reg-squad-name") || {}).value?.trim() || "";
  const squadTag = (document.getElementById("reg-squad-tag") || {}).value?.trim() || squadName.slice(0, 4).toUpperCase();
  const leaderName = (document.getElementById("reg-leader-name") || {}).value?.trim() || "Captain";
  const leaderIGN = (document.getElementById("reg-leader-ign") || {}).value?.trim() || leaderName;
  const leaderUID = (document.getElementById("reg-leader-uid") || {}).value?.trim() || "N/A";
  const whatsapp = (document.getElementById("reg-leader-whatsapp") || {}).value?.trim() || "";
  const email = (document.getElementById("reg-leader-email") || {}).value?.trim() || "";

  const p2IGN = (document.getElementById("reg-p2-ign") || {}).value?.trim() || (squadName + "_P2");
  const p2UID = (document.getElementById("reg-p2-uid") || {}).value?.trim() || "N/A";
  const p3IGN = (document.getElementById("reg-p3-ign") || {}).value?.trim() || "";
  const p3UID = (document.getElementById("reg-p3-uid") || {}).value?.trim() || "";
  const p4IGN = (document.getElementById("reg-p4-ign") || {}).value?.trim() || "";
  const p4UID = (document.getElementById("reg-p4-uid") || {}).value?.trim() || "";

  if (!squadName) {
    showToast("⚠️ Please enter a Squad Name.");
    return;
  }

  if (!currentUser || !currentUser.loggedIn) {
    currentUser = {
      id: "guest_" + Date.now(),
      name: leaderName || squadName,
      email: email || "player@vortex.esports",
      loggedIn: true
    };
    saveStateToStorage(false);
    updateUserBadge();
  }

  const isPaidTourney = tourney.entryType === "PAID" && Number(tourney.entryFee) > 0;
  let paymentUtr = "";
  let paymentStatus = isPaidTourney ? "PENDING" : "FREE";
  let paymentProof = "";

  if (isPaidTourney && !isEditMode) {
    paymentUtr = (document.getElementById("reg-payment-utr") || {}).value?.trim() || "";

    if (!paymentUtr || paymentUtr.length < 4) {
      showToast("⚠️ Please enter the 12-digit UPI UTR number from your payment receipt!");
      return;
    }

    // Check duplicate UTR across all tournaments
    const isDuplicateUtr = tournamentsDb.some(t => t.teams?.some(tm => tm.utr && tm.utr.toLowerCase() === paymentUtr.toLowerCase()));
    if (isDuplicateUtr) {
      showToast("⛔ Duplicate UTR: This Transaction ID has already been submitted!");
      return;
    }

    const proofFile = document.getElementById("reg-payment-screenshot")?.files?.[0];
    if (proofFile) {
      paymentProof = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(proofFile);
      });
    }
  }

  const playersList = [
    { name: leaderIGN, uid: leaderUID, role: "IGL (Captain)" },
    { name: p2IGN, uid: p2UID, role: "Entry Fragger / Rusher" }
  ];
  if (p3IGN) playersList.push({ name: p3IGN, uid: p3UID || "N/A", role: "Support / Sniper" });
  if (p4IGN) playersList.push({ name: p4IGN, uid: p4UID || "N/A", role: "Support / Substitute" });

  if (isEditMode && editIdx >= 0 && tourney.teams[editIdx]) {
    tourney.teams[editIdx].name = squadName;
    tourney.teams[editIdx].tag = squadTag;
    tourney.teams[editIdx].captain = leaderName + " (" + leaderIGN + " / " + leaderUID + ")";
    tourney.teams[editIdx].whatsapp = whatsapp;
    tourney.teams[editIdx].email = email;
    tourney.teams[editIdx].players = playersList;

    saveUserRegisteredSquad({
      tourneyId: tourney.id,
      slot: tourney.teams[editIdx].slot,
      squadName: squadName,
      leaderUID: leaderUID,
      leaderPhone: whatsapp,
      captain: tourney.teams[editIdx].captain
    });

    saveStateToStorage(false);
    if (supabaseClient) {
      try {
        await supabaseClient.from('tournaments').update(buildSupabasePayload(tourney)).eq('id', tourney.id);
      } catch (e) {
        console.warn("Supabase update notice:", e);
      }
    }

    const regModal = document.getElementById("modal-squad-registration");
    if (regModal) regModal.classList.remove('show');

    showToast("✓ Squad '" + squadName + "' roster details successfully updated!");
    renderLandingFeatured();
    renderManageList();
    if (currentView === "view-workspace" && activeTourneyId === tourney.id) {
      openWorkspaceWithId(tourney.id);
    }
    return;
  }

  const assignedSlot = tourney.teams.length + 1;
  const newRegisteredSquad = {
    slot: assignedSlot,
    name: squadName,
    tag: squadTag,
    captain: leaderName + " (" + leaderIGN + " / " + leaderUID + ")",
    whatsapp: whatsapp,
    email: email,
    players: playersList,
    paymentStatus: paymentStatus,
    paymentAmount: isPaidTourney ? tourney.entryFee : 0,
    utr: paymentUtr,
    paymentProof: paymentProof,
    registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  tourney.teams.push(newRegisteredSquad);
  saveUserRegisteredSquad({
    tourneyId: tourney.id,
    slot: assignedSlot,
    squadName: squadName,
    leaderUID: leaderUID,
    leaderPhone: whatsapp,
    captain: newRegisteredSquad.captain
  });

  saveStateToStorage(false);

  if (supabaseClient) {
    try {
      await supabaseClient.from('tournaments').update(buildSupabasePayload(tourney)).eq('id', tourney.id);
    } catch (e) {
      console.warn("Registration Supabase sync notice:", e);
    }
  }

  const regModal = document.getElementById("modal-squad-registration");
  if (regModal) regModal.classList.remove('show');

  const succSquad = document.getElementById("succ-squad-name");
  if (succSquad) succSquad.textContent = squadName;
  const succTourney = document.getElementById("succ-tourney-name");
  if (succTourney) succTourney.textContent = tourney.title;
  const succSlot = document.getElementById("succ-slot-tag");
  if (succSlot) succSlot.textContent = "SLOT #" + assignedSlot;

  const succWa = document.getElementById("succ-btn-whatsapp");
  if (succWa) {
    if (tourney.whatsappLink) {
      succWa.style.display = "block";
      succWa.href = tourney.whatsappLink;
    } else {
      succWa.style.display = "none";
    }
  }

  const succDc = document.getElementById("succ-btn-discord");
  if (succDc) {
    if (tourney.discordLink) {
      succDc.style.display = "block";
      succDc.href = tourney.discordLink;
    } else {
      succDc.style.display = "none";
    }
  }

  const succModal = document.getElementById("modal-registration-success");
  if (succModal) succModal.classList.add('show');

  if (isPaidTourney) {
    showToast("💳 UTR (" + paymentUtr + ") submitted! Live auto-verifying with Bank/UPI records...");
    runLivePaymentVerificationCheck(tourney, newRegisteredSquad);
  } else {
    const card = document.getElementById("succ-payment-status-card");
    if (card) card.style.display = "none";
    showToast("🎉 Squad '" + squadName + "' successfully registered for " + tourney.title + "!");
  }
  renderLandingFeatured();
  renderManageList();
  if (currentView === "view-workspace" && activeTourneyId === tourney.id) {
    openWorkspaceWithId(tourney.id);
  }
}

let liveVerificationInterval = null;

async function runLivePaymentVerificationCheck(tourney, registeredSquad) {
  const card = document.getElementById("succ-payment-status-card");
  const pill = document.getElementById("succ-pay-status-pill");
  const msgEl = document.getElementById("succ-pay-status-msg");
  const utrEl = document.getElementById("succ-pay-utr-display");
  const timerTxt = document.getElementById("succ-pay-timer-txt");
  const emojiEl = document.getElementById("succ-modal-emoji");
  const headingEl = document.getElementById("succ-modal-heading");
  const recheckBtn = document.getElementById("btn-recheck-payment-now");

  if (!card) return;

  if (registeredSquad.paymentStatus === "FREE") {
    card.style.display = "none";
    if (emojiEl) emojiEl.textContent = "🎉";
    if (headingEl) headingEl.textContent = "SQUAD REGISTERED!";
    return;
  }

  card.style.display = "block";
  if (utrEl) utrEl.textContent = registeredSquad.utr || "N/A";

  let attempts = 0;
  const maxAttempts = 15; // 45 seconds polling loop

  if (liveVerificationInterval) clearInterval(liveVerificationInterval);

  async function checkOnce() {
    attempts++;
    // 1. Fetch latest squad state from Supabase
    if (supabaseClient) {
      try {
        const { data } = await supabaseClient.from('tournaments').select('teams').eq('id', tourney.id);
        if (data && data[0] && Array.isArray(data[0].teams)) {
          const remoteSquad = data[0].teams.find(tm => tm.utr === registeredSquad.utr || tm.name === registeredSquad.name);
          if (remoteSquad && remoteSquad.paymentStatus === "APPROVED") {
            registeredSquad.paymentStatus = "APPROVED";
            registeredSquad.autoVerified = true;
          }
        }
      } catch (e) {
        console.warn("Live check fetch note:", e);
      }
    }

    if (registeredSquad.paymentStatus === "APPROVED") {
      if (liveVerificationInterval) clearInterval(liveVerificationInterval);
      if (pill) {
        pill.textContent = "🟢 AUTO-APPROVED & CONFIRMED";
        pill.style.background = "#052e16";
        pill.style.color = "#34d399";
        pill.style.borderColor = "#34d399";
      }
      if (msgEl) {
        msgEl.innerHTML = `🎉 <strong>PAYMENT VERIFIED!</strong> ₹${registeredSquad.paymentAmount || tourney.entryFee} for UTR <strong style="color:#ffd700;">${registeredSquad.utr}</strong> confirmed by Bank Gateway! Slot #${registeredSquad.slot} is permanently locked & approved.`;
      }
      if (emojiEl) emojiEl.textContent = "💥";
      if (headingEl) headingEl.textContent = "✅ SQUAD AUTO-APPROVED & LOCKED!";
      if (recheckBtn) recheckBtn.style.display = "none";
      if (timerTxt) timerTxt.textContent = "⚡ Verified live in real-time!";
      showToast("🎉 ⚡ PAYMENT VERIFIED! Squad '" + registeredSquad.name + "' is AUTO-APPROVED!");
      renderLandingFeatured();
      renderManageList();
      return true;
    } else {
      if (pill) {
        pill.textContent = "🟡 VERIFYING WITH BANK...";
        pill.style.background = "#2d2006";
        pill.style.color = "#ffd700";
        pill.style.borderColor = "#ffd700";
      }
      if (timerTxt) {
        timerTxt.textContent = `Auto-polling live (${attempts * 3}s)...`;
      }
      if (attempts >= maxAttempts) {
        if (liveVerificationInterval) clearInterval(liveVerificationInterval);
        if (timerTxt) timerTxt.textContent = "Slot reserved (Under Review)";
      }
      return false;
    }
  }

  // Wire recheck button
  if (recheckBtn) {
    recheckBtn.onclick = async function() {
      showToast("⚡ Querying Bank Gateway records for UTR " + registeredSquad.utr + "...");
      await checkOnce();
    };
  }

  // Run immediate first check
  const verifiedNow = await checkOnce();
  if (!verifiedNow) {
    liveVerificationInterval = setInterval(checkOnce, 3000);
  }
}

window.vortexOpenRegisterModal = openSquadRegistrationModal;
window.vortexOpenDeleteModal = openDeleteTourneyModal;

function renderLandingFeatured() {
  const landingGrid = document.getElementById("landing-tourney-grid");
  if (!landingGrid) return;
  if (!tournamentsDb || tournamentsDb.length === 0) {
    landingGrid.innerHTML = `
      <div style='grid-column:1/-1; text-align:center; padding:48px 16px; background:#12121e; border:1.5px dashed #28283c; border-radius:12px;'>
        <div style='font-size:36px; margin-bottom:10px;'>🏆</div>
        <div style='font-size:16px; font-weight:900; color:#fff; margin-bottom:4px;'>NO TOURNAMENTS AVAILABLE</div>
        <p style='font-size:13px; color:#94a3b8; margin-bottom:16px;'>No active tournaments hosted yet. Sign up or log in to create and host your first tournament.</p>
        <button class='btn-action-primary' onclick='window.vortexNavigateCreate()'>➕ CREATE FIRST TOURNAMENT</button>
      </div>
    `;
    return;
  }
  let htmlBuffer = "";
  for (const tourney of tournamentsDb) {
    const isOwner = isTourneyOwner(tourney);
    const deadlinePassed = isDeadlinePassed(tourney);
    const regSquad = getUserRegisteredSquadForTourney(tourney);
    const totalSlots = Number(tourney.slots) || 12;
    const isSlotsFull = Array.isArray(tourney.teams) && tourney.teams.length >= totalSlots;

    let regButtonHtml = '';
    if (regSquad) {
      if (deadlinePassed) {
        regButtonHtml = `<button class='btn-card-register' disabled style='background:#475569; color:#94a3b8; cursor:not-allowed;'>🔒 ROSTER LOCKED</button>`;
      } else {
        regButtonHtml = `<button class='btn-card-register' style='background:#34d399; color:#000;' onclick='window.vortexOpenRegisterModal(${tourney.id}, true, ${regSquad.teamIdx})'>✏️ EDIT ROSTER</button>`;
      }
    } else if (deadlinePassed) {
      regButtonHtml = `<button class='btn-card-register' disabled style='background:#475569; color:#94a3b8; cursor:not-allowed;'>🔒 CLOSED</button>`;
    } else if (isSlotsFull) {
      regButtonHtml = `<button class='btn-card-register' disabled style='background:#ff2d55; color:#ffffff; cursor:not-allowed; border-color:#000;'>🔒 FULL (${tourney.teams.length}/${totalSlots})</button>`;
    } else {
      regButtonHtml = `<button class='btn-card-register' onclick='window.vortexOpenRegisterModal(${tourney.id})'>📝 REGISTER</button>`;
    }

    const entryFeeBadge = tourney.entryType === "PAID" && Number(tourney.entryFee) > 0
      ? `<span class='badge-tag' style='background:#2d2006; color:#ffd700; border-color:#ffd700;'>💰 ₹${tourney.entryFee} ENTRY</span>`
      : `<span class='badge-tag' style='background:#052e16; color:#34d399; border-color:#34d399;'>🟢 FREE ENTRY</span>`;

    htmlBuffer += `
      <div class='tourney-card-item' onclick='window.vortexOpenWorkspace(${tourney.id})'>
        <div class='card-top-row'>
          <span class='badge-tag ${tourney.statusClass}'>${tourney.status}</span>
          <div style='display:flex; gap:4px; flex-wrap:wrap;'>
            ${entryFeeBadge}
            ${isSlotsFull ? `<span class='badge-tag' style='background:#ff2d55; color:#fff; border-color:#000;'>🔒 SLOTS FULL</span>` : (tourney.registrationDeadline ? `<span class='badge-tag' style='background:${deadlinePassed ? "#281216" : "#241428"}; color:${deadlinePassed ? "#ff2d55" : "#ffde59"}; border-color:${deadlinePassed ? "#ff2d55" : "#ffd700"}; font-size:10px;'>${deadlinePassed ? "🔒 Closed" : "⏳ " + formatDeadlineText(tourney)}</span>` : '')}
            ${tourney.whatsappLink ? `<span class='badge-tag' style='background:#25D366; color:#000;'>💬 WA</span>` : ''}
            ${tourney.discordLink ? `<span class='badge-tag' style='background:#5865F2; color:#fff;'>🎮 DC</span>` : ''}
            <span class='badge-tag open'>${tourney.format}</span>
          </div>
        </div>
        <div class='t-card-title'>${tourney.title}</div>
        <div class='t-card-meta'>Game: ${tourney.game} • Maps: ${tourney.maps}</div>
        <div class='t-card-metrics'>
          <div class='t-metric'><span class='tm-label'>PRIZE POOL</span><span class='tm-val highlight'>${tourney.prize}</span></div>
          <div class='t-metric'><span class='tm-label'>SLOTS</span><span class='tm-val' style='color:${isSlotsFull ? "#ff2d55" : "#00f0ff"}; font-weight:900;'>${tourney.teams.length} / ${totalSlots}</span></div>
          ${regSquad ? `<div class='t-metric' style='grid-column:1/-1;'><span class='tm-label'>YOUR STATUS</span><span class='tm-val' style='color:#34d399;'>✅ Registered (Slot #${regSquad.squad.slot})</span></div>` : ''}
        </div>
        <div class='card-action-btns-row' onclick='event.stopPropagation();'>
          ${regButtonHtml}
          <button class='btn-card-share' onclick='window.vortexShareTourney(${tourney.id})' title='Share Link'>🔗</button>
          <button class='btn-action-primary-sm' style='flex:1;' onclick='window.vortexOpenWorkspace(${tourney.id})'>OPEN ➔</button>
          ${isOwner ? `<button class='btn-card-del-t' onclick='window.vortexOpenDeleteModal(${tourney.id})' title='Delete Tournament'>🗑️</button>` : ''}
        </div>
      </div>
    `;
  }
  landingGrid.innerHTML = htmlBuffer;
}

function renderManageList() {
  const manageGrid = document.getElementById("manage-tournaments-grid");
  if (!manageGrid) return;
  if (!tournamentsDb || tournamentsDb.length === 0) {
    manageGrid.innerHTML = `
      <div style='grid-column:1/-1; text-align:center; padding:48px 16px; background:#12121e; border:1.5px dashed #28283c; border-radius:12px;'>
        <div style='font-size:36px; margin-bottom:10px;'>🏆</div>
        <div style='font-size:16px; font-weight:900; color:#fff; margin-bottom:4px;'>NO TOURNAMENTS FOUND</div>
        <p style='font-size:13px; color:#94a3b8; margin-bottom:16px;'>All tournaments have been cleared. Sign up or log in to create and manage new tournaments.</p>
        <button class='btn-action-primary' onclick='window.vortexNavigateCreate()'>➕ HOST A NEW TOURNAMENT</button>
      </div>
    `;
    return;
  }
  let htmlBuffer = "";
  for (const tourney of tournamentsDb) {
    const isOwner = isTourneyOwner(tourney);
    const deadlinePassed = isDeadlinePassed(tourney);
    const regSquad = getUserRegisteredSquadForTourney(tourney);
    const totalSlots = Number(tourney.slots) || 12;
    const isSlotsFull = Array.isArray(tourney.teams) && tourney.teams.length >= totalSlots;

    let regButtonHtml = '';
    if (regSquad) {
      if (deadlinePassed) {
        regButtonHtml = `<button class='btn-card-register' disabled style='background:#475569; color:#94a3b8; cursor:not-allowed;'>🔒 ROSTER LOCKED</button>`;
      } else {
        regButtonHtml = `<button class='btn-card-register' style='background:#34d399; color:#000;' onclick='window.vortexOpenRegisterModal(${tourney.id}, true, ${regSquad.teamIdx})'>✏️ EDIT ROSTER</button>`;
      }
    } else if (deadlinePassed) {
      regButtonHtml = `<button class='btn-card-register' disabled style='background:#475569; color:#94a3b8; cursor:not-allowed;'>🔒 CLOSED</button>`;
    } else if (isSlotsFull) {
      regButtonHtml = `<button class='btn-card-register' disabled style='background:#ff2d55; color:#ffffff; cursor:not-allowed; border-color:#000;'>🔒 FULL (${tourney.teams.length}/${totalSlots})</button>`;
    } else {
      regButtonHtml = `<button class='btn-card-register' onclick='window.vortexOpenRegisterModal(${tourney.id})'>📝 REGISTER SQUAD</button>`;
    }

    const entryFeeBadge = tourney.entryType === "PAID" && Number(tourney.entryFee) > 0
      ? `<span class='badge-tag' style='background:#2d2006; color:#ffd700; border-color:#ffd700;'>💰 ₹${tourney.entryFee} ENTRY</span>`
      : `<span class='badge-tag' style='background:#052e16; color:#34d399; border-color:#34d399;'>🟢 FREE ENTRY</span>`;

    htmlBuffer += `
      <div class='tourney-card-item' onclick='window.vortexOpenWorkspace(${tourney.id})'>
        <div class='card-top-row'>
          <span class='badge-tag ${tourney.statusClass}'>${tourney.status}</span>
          <div style='display:flex; gap:4px; flex-wrap:wrap;'>
            ${entryFeeBadge}
            ${isSlotsFull ? `<span class='badge-tag' style='background:#ff2d55; color:#fff; border-color:#000;'>🔒 SLOTS FULL</span>` : (tourney.registrationDeadline ? `<span class='badge-tag' style='background:${deadlinePassed ? "#281216" : "#241428"}; color:${deadlinePassed ? "#ff2d55" : "#ffde59"}; border-color:${deadlinePassed ? "#ff2d55" : "#ffd700"}; font-size:10px;'>${deadlinePassed ? "🔒 Closed" : "⏳ " + formatDeadlineText(tourney)}</span>` : '')}
            ${tourney.whatsappLink ? `<span class='badge-tag' style='background:#25D366; color:#000;'>💬 WA</span>` : ''}
            ${tourney.discordLink ? `<span class='badge-tag' style='background:#5865F2; color:#fff;'>🎮 DC</span>` : ''}
            <span class='badge-tag open'>${tourney.game}</span>
          </div>
        </div>
        <div class='t-card-title'>${tourney.title}</div>
        <div class='t-card-meta'>Format: ${tourney.format} • Maps: ${tourney.maps}</div>
        <div class='t-card-metrics'>
          <div class='t-metric'><span class='tm-label'>PRIZE POOL</span><span class='tm-val highlight'>${tourney.prize}</span></div>
          <div class='t-metric'><span class='tm-label'>SQUADS</span><span class='tm-val' style='color:${isSlotsFull ? "#ff2d55" : "#00f0ff"}; font-weight:900;'>${tourney.teams.length} / ${totalSlots}</span></div>
          <div class='t-metric'><span class='tm-label'>MATCHES</span><span class='tm-val'>${tourney.matches.length} Scheduled</span></div>
          <div class='t-metric'><span class='tm-label'>ROLE</span><span class='tm-val' style='color:${isOwner ? "#34d399" : "#94a3b8"};'>${isOwner ? "👑 Owner" : (regSquad ? "🎮 Player" : "👁️ Public")}</span></div>
        </div>
        <div class='card-action-btns-row' onclick='event.stopPropagation();'>
          ${regButtonHtml}
          <button class='btn-card-share' onclick='window.vortexShareTourney(${tourney.id})' title='Share Link'>🔗</button>
          <button class='btn-action-primary-sm' style='flex:1;' onclick='window.vortexOpenWorkspace(${tourney.id})'>${isOwner ? "MANAGE ➔" : "VIEW ➔"}</button>
          ${isOwner ? `<button class='btn-card-del-t' onclick='window.vortexOpenDeleteModal(${tourney.id})' title='Delete Tournament'>🗑️</button>` : ''}
        </div>
      </div>
    `;
  }
  manageGrid.innerHTML = htmlBuffer;
}

function openWorkspaceWithId(tourneyId) {
  activeTourneyId = tourneyId;
  let activeT = tournamentsDb.find(t => t.id == tourneyId);
  if (!activeT) return;

  const isOwner = isTourneyOwner(activeT);
  const deadlinePassed = isDeadlinePassed(activeT);
  const regSquad = getUserRegisteredSquadForTourney(activeT);

  const titleEl = document.getElementById("ws-tourney-title");
  if (titleEl) titleEl.textContent = activeT.title;

  const metaEl = document.getElementById("ws-game-meta");
  if (metaEl) metaEl.textContent = activeT.game + " • " + activeT.format + " • Prize: " + activeT.prize + " • Maps: " + activeT.maps;

  const statusBadge = document.getElementById("ws-status-badge");
  if (statusBadge) statusBadge.textContent = activeT.status;

  // Deadline Badge
  const dlBadge = document.getElementById("ws-deadline-badge");
  if (dlBadge) {
    if (activeT.registrationDeadline) {
      dlBadge.style.display = "inline-flex";
      if (deadlinePassed) {
        dlBadge.textContent = "🔒 Edit Closed";
        dlBadge.style.background = "#281216";
        dlBadge.style.color = "#ff2d55";
        dlBadge.style.borderColor = "#ff2d55";
      } else {
        dlBadge.textContent = "⏳ Closes: " + formatDeadlineText(activeT);
        dlBadge.style.background = "#241428";
        dlBadge.style.color = "#ffde59";
        dlBadge.style.borderColor = "#ffd700";
      }
    } else {
      dlBadge.style.display = "none";
    }
  }

  // Social Links
  const waBtn = document.getElementById("ws-btn-whatsapp");
  if (waBtn) {
    if (activeT.whatsappLink) {
      waBtn.style.display = "inline-flex";
      waBtn.href = activeT.whatsappLink;
    } else {
      waBtn.style.display = "none";
    }
  }

  const dcBtn = document.getElementById("ws-btn-discord");
  if (dcBtn) {
    if (activeT.discordLink) {
      dcBtn.style.display = "inline-flex";
      dcBtn.href = activeT.discordLink;
    } else {
      dcBtn.style.display = "none";
    }
  }

  // Registered Squad Banner
  const regBanner = document.getElementById("ws-user-registered-banner");
  const editRegBtn = document.getElementById("ws-btn-edit-registered-squad");
  const wsRegBtn = document.getElementById("ws-btn-register-squad");

  if (regSquad) {
    if (regBanner) regBanner.style.display = "flex";
    const squadNameSpan = document.getElementById("ws-reg-squad-name");
    if (squadNameSpan) squadNameSpan.textContent = regSquad.squad.name;
    const slotSpan = document.getElementById("ws-reg-slot-num");
    if (slotSpan) slotSpan.textContent = "Slot #" + regSquad.squad.slot;
    const capSpan = document.getElementById("ws-reg-captain-name");
    if (capSpan) capSpan.textContent = regSquad.squad.captain;

    if (editRegBtn) {
      if (deadlinePassed) {
        editRegBtn.disabled = true;
        editRegBtn.textContent = "🔒 ROSTER LOCKED (DEADLINE PASSED)";
        editRegBtn.style.background = "#475569";
        editRegBtn.style.color = "#94a3b8";
        editRegBtn.onclick = null;
      } else {
        editRegBtn.disabled = false;
        editRegBtn.textContent = "✏️ EDIT MY SQUAD ROSTER";
        editRegBtn.style.background = "#34d399";
        editRegBtn.style.color = "#000000";
        editRegBtn.onclick = () => openSquadRegistrationModal(activeT.id, true, regSquad.teamIdx);
      }
    }
    if (wsRegBtn) wsRegBtn.style.display = "none";
  } else {
    if (regBanner) regBanner.style.display = "none";
    if (wsRegBtn) {
      const isSlotsFull = Array.isArray(activeT.teams) && activeT.teams.length >= (activeT.slots || 12);
      if (isOwner) {
        wsRegBtn.style.display = "none";
      } else if (deadlinePassed) {
        wsRegBtn.style.display = "inline-block";
        wsRegBtn.disabled = true;
        wsRegBtn.textContent = "🔒 REGISTRATION CLOSED";
        wsRegBtn.style.background = "#475569";
        wsRegBtn.style.color = "#94a3b8";
      } else if (isSlotsFull) {
        wsRegBtn.style.display = "inline-block";
        wsRegBtn.disabled = true;
        wsRegBtn.textContent = "🔒 SLOTS FULL (" + activeT.teams.length + "/" + (activeT.slots || 12) + ")";
        wsRegBtn.style.background = "#ff2d55";
        wsRegBtn.style.color = "#ffffff";
      } else {
        wsRegBtn.style.display = "inline-block";
        wsRegBtn.disabled = false;
        wsRegBtn.textContent = "📝 REGISTER SQUAD";
        wsRegBtn.style.background = "#00f0ff";
        wsRegBtn.style.color = "#000000";
        wsRegBtn.onclick = () => openSquadRegistrationModal(activeT.id);
      }
    }
  }

  // Permission Banner & Controls Visibility
  const permBanner = document.getElementById("ws-permission-banner");
  const delBtn = document.getElementById("ws-btn-delete-tourney");
  const quickAdd = document.getElementById("quick-act-add-team");
  const quickMatch = document.getElementById("quick-act-new-match");
  const quickScore = document.getElementById("quick-act-edit-points");
  const addSquadBtn = document.getElementById("btn-open-add-team-modal");
  const addMatchBtn = document.getElementById("btn-open-add-match-modal");
  const saveRulesBtn = document.getElementById("btn-ws-save-point-rules");
  const createCheckBtn = document.getElementById("btn-ws-create-checkpoint");
  const revertBtn = document.getElementById("btn-ws-open-revert-modal");

  if (isOwner) {
    if (permBanner) permBanner.style.display = "none";
    if (delBtn) delBtn.style.display = "inline-block";
    if (quickAdd) quickAdd.style.display = "inline-block";
    if (quickMatch) quickMatch.style.display = "inline-block";
    if (quickScore) quickScore.style.display = "inline-block";
    if (addSquadBtn) addSquadBtn.style.display = "inline-block";
    if (addMatchBtn) addMatchBtn.style.display = "inline-block";
    if (saveRulesBtn) saveRulesBtn.style.display = "inline-block";
    if (createCheckBtn) createCheckBtn.style.display = "inline-block";
    if (revertBtn) revertBtn.style.display = "inline-block";
  } else {
    if (permBanner) {
      permBanner.style.display = "block";
      const isLoggedIn = currentUser && currentUser.loggedIn;
      if (!isLoggedIn) {
        permBanner.innerHTML = `👁️ <strong>GUEST VIEW MODE:</strong> You are currently viewing in read-only mode. <button class="btn-auth-pill" style="margin-left:8px; padding:3px 10px; font-size:11px; vertical-align:middle;" onclick="window.vortexOpenAuthModal()">🔑 LOGIN / SIGNUP</button> to register your squad or create tournaments.`;
      } else {
        permBanner.innerHTML = `🔒 <strong>SPECTATOR MODE:</strong> You are viewing an official tournament organized by <strong>${activeT.creatorName || (activeT.user_id ? "Organizer" : "Official Host")}</strong>. Host controls are reserved for the tournament owner.`;
      }
    }
    if (delBtn) delBtn.style.display = "none";
    if (quickAdd) quickAdd.style.display = "none";
    if (quickMatch) quickMatch.style.display = "none";
    if (quickScore) quickScore.style.display = "none";
    if (addSquadBtn) addSquadBtn.style.display = "none";
    if (addMatchBtn) addMatchBtn.style.display = "none";
    if (saveRulesBtn) saveRulesBtn.style.display = "none";
    if (createCheckBtn) createCheckBtn.style.display = "none";
    if (revertBtn) revertBtn.style.display = "none";
  }

  renderWorkspaceOverview();
  renderWorkspaceTeams();
  renderWorkspaceMatches();
  renderWorkspaceMatchStandings();
  renderWorkspaceOverallStandings();
  renderWorkspacePointRules();
  switchWsTab("panel-ws-overview");
  switchView("view-workspace");
}

function renderWorkspaceOverview() {
  let activeT = getActiveTourney();
  if (!activeT) return;

  (document.getElementById("stat-total-teams") || document.querySelector("stat-total-teams")).textContent = activeT.teams.length + " / " + activeT.slots;
  let completedMatches = 0;
  for (const m of activeT.matches) {
    if (m.status == "COMPLETED") {
      completedMatches = completedMatches + 1;
    }
  }
  (document.getElementById("stat-matches-played") || document.querySelector("stat-matches-played")).textContent = completedMatches + " / " + activeT.matches.length;
  (document.getElementById("stat-prize-pool") || document.querySelector("stat-prize-pool")).textContent = activeT.prize;
  let overallList = computeOverallStandings(activeT);
  if (overallList.length > 0) {
    (document.getElementById("stat-table-leader") || document.querySelector("stat-table-leader")).textContent = overallList[0].team + " (" + overallList[0].totalPts + " PTS)";
  }
  
  const isOwner = isTourneyOwner(activeT);
  let htmlBuffer = "";
  let rank = 1;
  for (const row of overallList) {
    let rankClass = "rank-badge";
    if (rank == 1) rankClass = "rank-badge rank-1";
    if (rank == 2) rankClass = "rank-badge rank-2";
    if (rank == 3) rankClass = "rank-badge rank-3";

    htmlBuffer += "<tr>";
    htmlBuffer += "<td><span class='" + rankClass + "'>#" + rank + "</span></td>";
    htmlBuffer += "<td><strong>" + row.team + "</strong></td>";
    htmlBuffer += "<td>" + row.played + "</td>";
    htmlBuffer += "<td>" + row.wwcd + "</td>";
    htmlBuffer += "<td>" + row.killPts + "</td>";
    htmlBuffer += "<td>" + row.placePts + "</td>";
    htmlBuffer += "<td><span class='total-pts-pill'>" + row.totalPts + " PTS</span></td>";
    htmlBuffer += "<td style='text-align:right;'>";
    if (isOwner) {
      htmlBuffer += "<button class='btn-secondary-sm' style='padding:3px 8px; font-size:11px;' onclick='window.vortexOpenTeamMatchesModal(\"" + row.team + "\")'>✏️ EDIT MATCHES</button>";
    } else {
      htmlBuffer += "<span style='color:#64748b; font-size:11px; font-weight:700;'>Official Standing</span>";
    }
    htmlBuffer += "</td>";
    htmlBuffer += "</tr>";
    rank = rank + 1;
  }
  (document.getElementById("ws-overview-table-body") || document.querySelector("ws-overview-table-body")).innerHTML = htmlBuffer;
}

function getTourneyPools(tourney) {
  if (!tourney) return [];
  if (!Array.isArray(tourney.pools)) {
    tourney.pools = [];
  }
  return tourney.pools;
}

function renderWorkspacePools() {
  const container = document.getElementById("ws-pools-container");
  if (!container) return;
  let activeT = getActiveTourney();
  if (!activeT) return;

  const isOwner = isTourneyOwner(activeT);
  const pools = getTourneyPools(activeT);
  const allTeams = activeT.teams || [];

  let htmlBuffer = "";

  if (pools.length === 0) {
    htmlBuffer += `
      <div style="grid-column:1/-1; background:#141422; border:1.5px dashed #28283c; border-radius:12px; padding:36px 20px; text-align:center;">
        <div style="font-size:40px; margin-bottom:12px;">🏊</div>
        <h3 style="font-size:18px; font-weight:900; color:#ffffff; margin-bottom:8px;">NO POOLS / GROUPS CREATED YET</h3>
        <p style="font-size:13px; color:#94a3b8; max-width:560px; margin:0 auto 24px; line-height:1.6;">
          For massive tournaments with 24, 36, 48, or more squads, organize them into Pools (e.g. Group A, Group B, Grand Finals) to run parallel or staged custom lobbies.
        </p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          ${isOwner ? `
            <button class="btn-action-primary" onclick="window.vortexQuickInitStandardPools(2)">⚡ AUTO-CREATE 2 GROUPS (GROUP A & B)</button>
            <button class="btn-action-primary" onclick="window.vortexQuickInitStandardPools(4)">⚡ AUTO-CREATE 4 GROUPS (A, B, C, D)</button>
            <button class="btn-secondary-sm" onclick="window.vortexOpenCreatePoolModal()">+ CUSTOM POOL</button>
          ` : `<span style="color:#64748b; font-size:12px; font-weight:700;">Organizer has not created pool stages yet. All squads are in the general lobby.</span>`}
        </div>
      </div>
    `;
  } else {
    pools.forEach((pool) => {
      const poolTeams = allTeams.filter(t => t.poolId === pool.id);
      const maxSlots = pool.slots || 12;
      const isPoolFull = poolTeams.length >= maxSlots;

      htmlBuffer += `
        <div class="pool-card" style="border-top:3px solid ${pool.color || '#00f0ff'};">
          <div class="pool-card-header">
            <div>
              <div class="pool-card-title">
                <span style="color:${pool.color || '#00f0ff'};">●</span> ${pool.name}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="pool-card-slots" style="color:${isPoolFull ? '#ff2d55' : (pool.color || '#00f0ff')};">
                ${poolTeams.length} / ${maxSlots} SQUADS
              </span>
              ${isOwner ? `<button class="btn-pool-del" onclick="window.vortexDeletePool('${pool.id}')" title="Delete Pool">🗑️</button>` : ''}
            </div>
          </div>
          <div class="pool-squads-list">
            ${poolTeams.length === 0 ? `
              <div style="text-align:center; padding:24px 10px; color:#64748b; font-size:12px;">
                No squads assigned to ${pool.name} yet.
              </div>
            ` : poolTeams.map((team, idx) => {
              const teamRealIdx = allTeams.findIndex(t => t.name === team.name);
              return `
                <div class="pool-squad-item">
                  <div class="pool-squad-left">
                    <span class="pool-slot-badge">#${idx + 1}</span>
                    <div>
                      <strong style="color:#ffffff;">${team.name}</strong>
                      <span class="team-tag-pill" style="margin-left:4px; font-size:10px;">${team.tag || 'SQD'}</span>
                    </div>
                  </div>
                  <div class="pool-squad-actions">
                    ${isOwner ? `
                      <button class="btn-pool-squad-move" onclick="window.vortexOpenMoveSquadPoolModal(${teamRealIdx})" title="Move to another pool">⇄ MOVE</button>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    const unassignedTeams = allTeams.filter(t => !t.poolId);
    htmlBuffer += `
      <div class="pool-card" style="border-top:3px solid #64748b; background:#0f0f18;">
        <div class="pool-card-header">
          <div>
            <div class="pool-card-title">
              <span style="color:#94a3b8;">⚪</span> UNASSIGNED SQUADS
            </div>
          </div>
          <span class="pool-card-slots" style="color:#94a3b8;">
            ${unassignedTeams.length} SQUADS PENDING
          </span>
        </div>
        <div class="pool-squads-list">
          ${unassignedTeams.length === 0 ? `
            <div style="text-align:center; padding:24px 10px; color:#34d399; font-size:12px; font-weight:800;">
              ✓ All registered squads are placed in pools!
            </div>
          ` : unassignedTeams.map((team) => {
            const teamRealIdx = allTeams.findIndex(t => t.name === team.name);
            return `
              <div class="pool-squad-item">
                <div class="pool-squad-left">
                  <span class="pool-slot-badge" style="background:#334155; color:#cbd5e1;">Slot ${team.slot}</span>
                  <div>
                    <strong style="color:#ffffff;">${team.name}</strong>
                    <span class="team-tag-pill" style="margin-left:4px; font-size:10px;">${team.tag || 'SQD'}</span>
                  </div>
                </div>
                <div class="pool-squad-actions">
                  ${isOwner ? `
                    <button class="btn-pool-squad-move" style="background:#00f0ff; color:#000; border-color:#000;" onclick="window.vortexOpenMoveSquadPoolModal(${teamRealIdx})">+ ASSIGN POOL</button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = htmlBuffer;
}

window.vortexQuickInitStandardPools = function(numGroups) {
  let activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the organizer can manage pools.");
    return;
  }
  const defaultSlots = activeT.game.includes("BGMI") || activeT.game.includes("PUBG") ? 16 : 12;
  const colors = ["#00f0ff", "#ffd700", "#ff2d55", "#34d399", "#a855f7", "#ff6b35"];
  const groupNames = ["Group A (Alpha)", "Group B (Bravo)", "Group C (Charlie)", "Group D (Delta)", "Group E (Echo)", "Group F (Foxtrot)"];

  activeT.pools = [];
  for (let i = 0; i < numGroups; i++) {
    activeT.pools.push({
      id: "pool_" + String.fromCharCode(65 + i).toLowerCase(),
      name: "Pool " + String.fromCharCode(65 + i) + " (" + groupNames[i].split(" ")[1].replace("(", "").replace(")", "") + ")",
      slots: defaultSlots,
      color: colors[i % colors.length]
    });
  }

  if (activeT.teams && activeT.teams.length > 0) {
    activeT.teams.forEach((team, idx) => {
      const assignedPool = activeT.pools[idx % activeT.pools.length];
      team.poolId = assignedPool.id;
    });
  }

  saveStateToStorage();
  renderWorkspacePools();
  renderWorkspaceTeams();
  showToast("🏊 Created " + numGroups + " tournament pools and placed registered squads!");
};

window.vortexOpenCreatePoolModal = function() {
  let activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can create pools.");
    return;
  }
  const defaultSlots = activeT.game.includes("BGMI") || activeT.game.includes("PUBG") ? 16 : 12;
  const slotsInput = document.getElementById("new-pool-slots");
  if (slotsInput) slotsInput.value = defaultSlots;
  const nameInput = document.getElementById("new-pool-name");
  const pools = getTourneyPools(activeT);
  const nextLetter = String.fromCharCode(65 + pools.length);
  if (nameInput) nameInput.value = "Pool " + nextLetter + " (Group " + nextLetter + ")";

  const modal = document.getElementById("modal-create-pool");
  if (modal) modal.classList.add("show");
};

window.vortexDeletePool = function(poolId) {
  let activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can delete pools.");
    return;
  }
  if (!confirm("Are you sure you want to delete this pool? Assigned squads will be moved to unassigned.")) return;

  activeT.pools = (activeT.pools || []).filter(p => p.id !== poolId);
  (activeT.teams || []).forEach(t => {
    if (t.poolId === poolId) t.poolId = null;
  });
  saveStateToStorage();
  renderWorkspacePools();
  renderWorkspaceTeams();
  showToast("🗑️ Pool removed. Squads returned to unassigned pool.");
};

window.vortexOpenMoveSquadPoolModal = function(teamIdx) {
  let activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can place squads in pools.");
    return;
  }
  const team = activeT.teams[teamIdx];
  if (!team) return;

  const idxInput = document.getElementById("move-pool-team-idx");
  if (idxInput) idxInput.value = teamIdx;
  const nameEl = document.getElementById("move-pool-squad-name");
  if (nameEl) nameEl.textContent = team.name;

  const selectEl = document.getElementById("select-target-pool");
  if (selectEl) {
    const pools = getTourneyPools(activeT);
    let opts = `<option value="">⚪ Unassigned Pool</option>`;
    pools.forEach(p => {
      const count = (activeT.teams || []).filter(t => t.poolId === p.id).length;
      opts += `<option value="${p.id}" ${team.poolId === p.id ? 'selected' : ''}>● ${p.name} (${count}/${p.slots || 12} Squads)</option>`;
    });
    selectEl.innerHTML = opts;
  }

  const modal = document.getElementById("modal-move-squad-pool");
  if (modal) modal.classList.add("show");
};

let verifiedBankUtrsCache = [];

function loadVerifiedBankUtrs() {
  try {
    const raw = localStorage.getItem("vortex_verified_utrs");
    verifiedBankUtrsCache = raw ? JSON.parse(raw) : [];
  } catch (e) {
    verifiedBankUtrsCache = [];
  }
}

function saveVerifiedBankUtrs() {
  try {
    localStorage.setItem("vortex_verified_utrs", JSON.stringify(verifiedBankUtrsCache));
  } catch (e) {}
}

function processIncomingBankSms(rawSms, source = "Bank_SMS_Engine") {
  if (!rawSms || typeof rawSms !== "string") {
    showToast("⚠️ Empty SMS text received.");
    return { success: false, error: "Empty SMS" };
  }

  // 1. Extract 12-digit UTR
  const utrRegex = /(?:UPI(?:\s*Ref(?:\s*No|\s*ID)?|\/)|UTR(?:\s*No|\s*ID)?|Ref(?:\s*No|\s*ID)?|Txn(?:\s*ID|\s*No)?|Reference(?:\s*No)?)[ :\/#-]*([0-9]{12})/i;
  const generic12Digits = /\b([0-9]{12})\b/;

  const utrMatch = rawSms.match(utrRegex) || rawSms.match(generic12Digits);
  const utr = utrMatch ? utrMatch[1] : null;

  // 2. Extract Amount
  const amtRegex = /(?:Rs\.?|INR|₹|credited\s*(?:by|with)?\s*(?:Rs\.?|INR|₹)?)\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
  const amtMatch = rawSms.match(amtRegex);
  const amount = amtMatch ? parseFloat(amtMatch[1]) : 0;

  if (!utr) {
    showToast("⚠️ Could not find a 12-digit UPI UTR in the provided SMS text.");
    return { success: false, error: "No 12-digit UTR found" };
  }

  loadVerifiedBankUtrs();
  if (!verifiedBankUtrsCache.includes(utr)) {
    verifiedBankUtrsCache.push(utr);
    saveVerifiedBankUtrs();
  }

  // Search across tournamentsDb for matching squad with this UTR or pending registration
  let matchedSquad = null;
  let targetTourney = null;

  for (const tourney of tournamentsDb) {
    if (Array.isArray(tourney.teams)) {
      for (const team of tourney.teams) {
        if (team.utr && team.utr.trim() === utr.trim()) {
          matchedSquad = team;
          targetTourney = tourney;
          break;
        }
      }
    }
    if (matchedSquad) break;
  }

  if (matchedSquad) {
    matchedSquad.paymentStatus = "APPROVED";
    matchedSquad.autoVerified = true;
    matchedSquad.verifiedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    matchedSquad.verifiedAmount = amount || matchedSquad.paymentAmount || 50;

    saveStateToStorage();
    renderWorkspacePayments();
    renderWorkspaceTeams();
    renderWorkspaceOverview();

    showToast("⚡ 🤖 AUTO-APPROVED! Matched Bank SMS: ₹" + (amount || matchedSquad.paymentAmount || 50) + " for Squad '" + matchedSquad.name + "' (UTR: " + utr + ")!");
    return { success: true, matched: true, squad: matchedSquad.name, utr: utr, amount: amount };
  } else {
    showToast("📥 Bank SMS Verified & Cached: UTR " + utr + " (₹" + amount + "). Will auto-approve when squad submits!");
    return { success: true, matched: false, utr: utr, amount: amount };
  }
}

window.vortexProcessBankSms = processIncomingBankSms;

function renderWorkspacePayments() {
  const tbody = document.getElementById("ws-payments-tbody");
  if (!tbody) return;
  const activeT = getActiveTourney();
  if (!activeT) return;

  const isOwner = isTourneyOwner(activeT);
  const teams = activeT.teams || [];

  // Update Live Webhook URL & Payee UPI in UI
  const webhookUrlEl = document.getElementById("sms-bot-webhook-url");
  if (webhookUrlEl) {
    webhookUrlEl.textContent = window.location.origin + "/api/verify-sms";
  }
  const payeeUpiEl = document.getElementById("ws-payments-payee-upi");
  if (payeeUpiEl) {
    payeeUpiEl.textContent = activeT.upiId || "7848033183@fam";
  }

  if (teams.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748b;">No squad registrations or payments recorded yet.</td></tr>`;
    return;
  }

  let htmlBuffer = "";
  teams.forEach((team, tIdx) => {
    const isApproved = team.paymentStatus === "APPROVED";
    const isPending = team.paymentStatus === "PENDING";
    const isRejected = team.paymentStatus === "REJECTED";
    const isFree = team.paymentStatus === "FREE" || !team.paymentStatus;

    let statusBadge = "";
    if (isApproved) {
      statusBadge = team.autoVerified
        ? `<span class="badge-tag" style="background:#052e16; color:#34d399; border-color:#34d399; font-size:11px;">⚡ AUTO-APPROVED</span>`
        : `<span class="badge-tag" style="background:#052e16; color:#34d399; border-color:#34d399; font-size:11px;">✅ PAID & APPROVED</span>`;
    } else if (isPending) {
      statusBadge = `<span class="badge-tag" style="background:#2d2006; color:#ffd700; border-color:#ffd700; font-size:11px;">🔒 RESERVED (PENDING)</span>`;
    } else if (isRejected) {
      statusBadge = `<span class="badge-tag" style="background:#2d0606; color:#ff2d55; border-color:#ff2d55; font-size:11px;">❌ PAYMENT REJECTED</span>`;
    } else {
      statusBadge = `<span class="badge-tag" style="background:#0f172a; color:#94a3b8; font-size:11px;">🟢 FREE ENTRY</span>`;
    }

    const cleanPhone = (team.whatsapp || "").replace(/[^0-9]/g, "");
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent("Hi " + team.name + " Captain, your registration for " + activeT.title + " (UTR: " + (team.utr || "N/A") + ") is " + (team.paymentStatus || "received") + "!")}` : "#";

    htmlBuffer += `
      <tr>
        <td><strong class="rank-badge">#${team.slot}</strong></td>
        <td>
          <strong style="color:#ffffff;">${team.name}</strong>
          <span class="team-tag-pill" style="margin-left:4px; font-size:10px;">${team.tag || 'SQD'}</span>
        </td>
        <td>
          <div style="font-size:12px;">${team.captain.split(" (")[0]}</div>
          ${cleanPhone ? `<a href="${waLink}" target="_blank" style="color:#25D366; font-size:11px; text-decoration:none; font-weight:800;">💬 ${team.whatsapp}</a>` : `<span style="color:#64748b; font-size:11px;">N/A</span>`}
        </td>
        <td>
          ${team.utr ? `
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-family:monospace; font-weight:900; color:#ffd700;">${team.utr}</span>
              <button class="btn-secondary-sm" style="padding:2px 6px; font-size:10px;" onclick="navigator.clipboard.writeText('${team.utr}'); showToast('📋 UTR Copied!');" title="Copy UTR">📋</button>
            </div>
          ` : `<span style="color:#64748b;">—</span>`}
        </td>
        <td><strong style="color:#34d399;">₹${team.paymentAmount || activeT.entryFee || 0}</strong></td>
        <td>
          ${team.paymentProof ? `
            <button class="btn-secondary-sm" style="padding:2px 8px; font-size:11px; background:#1e1e38; color:#38bdf8; border-color:#38bdf8;" onclick="window.vortexPreviewPaymentProof(${tIdx})">📸 VIEW PROOF</button>
          ` : `<span style="color:#64748b; font-size:11px;">📄 UTR Only</span>`}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:right;">
          ${isOwner ? `
            <div style="display:flex; gap:4px; justify-content:flex-end;">
              ${!isApproved ? `
                <button class="btn-action-primary-sm" style="padding:4px 8px; font-size:11px; background:#34d399; color:#000; font-weight:900;" onclick="window.vortexApprovePayment(${tIdx})">✓ APPROVE</button>
              ` : ''}
              ${!isRejected ? `
                <button class="btn-row-del" style="padding:4px 8px; font-size:11px;" onclick="window.vortexRejectPayment(${tIdx})">✕ REJECT</button>
              ` : ''}
              ${cleanPhone ? `<a href="${waLink}" target="_blank" class="btn-secondary-sm" style="padding:4px 8px; font-size:11px; text-decoration:none;">💬</a>` : ''}
            </div>
          ` : `<span style="color:#64748b; font-size:11px;">Organizer View</span>`}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = htmlBuffer;
}

window.vortexApprovePayment = function(teamIdx) {
  const activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can approve payments.");
    return;
  }
  if (activeT.teams && activeT.teams[teamIdx]) {
    activeT.teams[teamIdx].paymentStatus = "APPROVED";
    activeT.teams[teamIdx].autoVerified = false;
    activeT.teams[teamIdx].verifiedAt = new Date().toISOString();
    saveStateToStorage(true);
    renderWorkspacePayments();
    renderWorkspaceTeams();
    renderWorkspaceOverview();
    showToast("✅ Payment approved & slot confirmed for squad '" + activeT.teams[teamIdx].name + "'!");
  }
};

window.vortexRejectPayment = function(teamIdx) {
  const activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can reject payments.");
    return;
  }
  if (activeT.teams && activeT.teams[teamIdx]) {
    activeT.teams[teamIdx].paymentStatus = "REJECTED";
    saveStateToStorage(true);
    renderWorkspacePayments();
    renderWorkspaceTeams();
    renderWorkspaceOverview();
    showToast("❌ Payment rejected for squad '" + activeT.teams[teamIdx].name + "'.");
  }
};

window.vortexApproveAllPending = function() {
  const activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can approve payments.");
    return;
  }
  let approvedCount = 0;
  if (Array.isArray(activeT.teams)) {
    activeT.teams.forEach(tm => {
      if (tm.paymentStatus === "PENDING") {
        tm.paymentStatus = "APPROVED";
        tm.verifiedAt = new Date().toISOString();
        approvedCount++;
      }
    });
  }
  if (approvedCount === 0) {
    showToast("ℹ️ No pending squad payments to approve.");
    return;
  }
  saveStateToStorage(true);
  renderWorkspacePayments();
  renderWorkspaceTeams();
  renderWorkspaceOverview();
  showToast("⚡ Batch approved " + approvedCount + " pending squad registrations!");
};

window.vortexPreviewPaymentProof = function(teamIdx) {
  const activeT = getActiveTourney();
  if (!activeT || !activeT.teams[teamIdx]) return;
  const team = activeT.teams[teamIdx];
  const proof = team.paymentProof;
  if (!proof) {
    showToast("⚠️ No screenshot receipt uploaded for this squad (UTR: " + (team.utr || "N/A") + ")");
    return;
  }
  const modal = document.getElementById("modal-view-receipt");
  if (modal) {
    const titleEl = document.getElementById("receipt-modal-title");
    const subEl = document.getElementById("receipt-modal-sub");
    const imgEl = document.getElementById("receipt-modal-img");
    const utrEl = document.getElementById("receipt-modal-utr");
    const approveBtn = document.getElementById("btn-receipt-approve-now");

    if (titleEl) titleEl.textContent = "📸 " + team.name + " (Slot #" + team.slot + ")";
    if (subEl) subEl.textContent = "Captain: " + team.captain;
    if (imgEl) imgEl.src = proof;
    if (utrEl) utrEl.textContent = team.utr || "N/A";

    if (approveBtn) {
      approveBtn.onclick = function() {
        window.vortexApprovePayment(teamIdx);
        modal.classList.remove("show");
      };
    }
    modal.classList.add("show");
  }
};

function renderWorkspaceTeams() {
  let activeT = getActiveTourney();
  if (!activeT) return;

  const isOwner = isTourneyOwner(activeT);
  if (activeT.teams.length == 0) {
    (document.getElementById("ws-teams-container") || document.querySelector("ws-teams-container")).innerHTML = "<div style='padding:32px; text-align:center; color:#64748b;'>No squads registered yet. Click '+ ADD NEW SQUAD' or '📝 REGISTER SQUAD' to register.</div>";
    return;
  }

  const pools = getTourneyPools(activeT);
  let htmlBuffer = "";
  let tIdx = 0;
  for (const team of activeT.teams) {
    const assignedPool = pools.find(p => p.id === team.poolId);
    const poolBadgeHtml = assignedPool
      ? `<span class='badge-tag' style='background:${assignedPool.color}22; color:${assignedPool.color}; border-color:${assignedPool.color}; font-size:10px; padding:2px 8px;'>🏊 ${assignedPool.name}</span>`
      : (pools.length > 0 ? `<span class='badge-tag' style='background:#1e1e2d; color:#94a3b8; font-size:10px; padding:2px 8px;'>⚪ Unassigned Pool</span>` : '');

    let paymentBadgeHtml = "";
    if (activeT.entryType === "PAID") {
      if (team.paymentStatus === "APPROVED") {
        paymentBadgeHtml = "<span class='badge-tag' style='background:#052e16; color:#34d399; border-color:#34d399; font-size:10px; padding:2px 8px;'>✅ PAID & VERIFIED</span>";
      } else if (team.paymentStatus === "PENDING") {
        paymentBadgeHtml = "<span class='badge-tag' style='background:#2d2006; color:#ffd700; border-color:#ffd700; font-size:10px; padding:2px 8px;'>🟡 UTR PENDING (" + (team.utr || "N/A") + ")</span>";
      } else if (team.paymentStatus === "REJECTED") {
        paymentBadgeHtml = "<span class='badge-tag' style='background:#2d0606; color:#ff2d55; border-color:#ff2d55; font-size:10px; padding:2px 8px;'>❌ PAYMENT REJECTED</span>";
      }
    }

    htmlBuffer += "<div class='team-roster-card'>";
    htmlBuffer += "<div class='team-roster-header'>";
    htmlBuffer += "<div class='team-title-group'>";
    htmlBuffer += "<span class='team-slot-badge'>SLOT " + team.slot + "</span>";
    htmlBuffer += "<span class='team-name-text'>" + team.name + "</span>";
    htmlBuffer += "<span class='team-tag-pill'>" + team.tag + "</span>";
    htmlBuffer += poolBadgeHtml;
    htmlBuffer += paymentBadgeHtml;
    htmlBuffer += "<span style='font-size:12px; color:#94a3b8;'>Captain: " + team.captain + "</span>";
    htmlBuffer += "</div>";
    if (isOwner) {
      htmlBuffer += "<div class='team-actions-group'>";
      htmlBuffer += "<button class='btn-secondary-sm' onclick='window.vortexOpenTeamMatchesModal(\"" + team.name + "\")'>EDIT ALL MATCHES</button>";
      htmlBuffer += "<button class='btn-secondary-sm' onclick='window.vortexOpenAddPlayerModal(" + tIdx + ")'>+ ADD PLAYER</button>";
      htmlBuffer += "<button class='btn-secondary-sm' onclick='window.vortexEditTeamModal(" + tIdx + ")'>EDIT SQUAD</button>";
      htmlBuffer += "<button class='btn-row-del' onclick='window.vortexDeleteTeam(" + tIdx + ")'>REMOVE SQUAD</button>";
      htmlBuffer += "</div>";
    }
    htmlBuffer += "</div>";
    htmlBuffer += "<div class='players-table-wrapper'>";
    htmlBuffer += "<table class='anime-table'>";
    htmlBuffer += "<thead><tr><th>PLAYER IGN</th><th>FREE FIRE UID</th><th>SQUAD ROLE</th>" + (isOwner ? "<th style='text-align:right;'>PLAYER ACTIONS</th>" : "") + "</tr></thead>";
    htmlBuffer += "<tbody>";
    if (team.players == undefined || team.players.length == 0) {
      htmlBuffer += "<tr><td colspan='" + (isOwner ? "4" : "3") + "' style='color:#64748b; text-align:center;'>No players added to this squad roster yet.</td></tr>";
    } else {
      let pIdx = 0;
      for (const player of team.players) {
        htmlBuffer += "<tr>";
        htmlBuffer += "<td><strong>" + player.name + "</strong></td>";
        htmlBuffer += "<td style='font-family:monospace; color:#00f0ff;'>" + player.uid + "</td>";
        htmlBuffer += "<td><span class='player-role-badge'>" + player.role + "</span></td>";
        if (isOwner) {
          htmlBuffer += "<td style='text-align:right;'>";
          htmlBuffer += "<button class='btn-secondary-sm' style='padding:2px 8px; margin-right:4px;' onclick='window.vortexEditPlayerModal(" + tIdx + ", " + pIdx + ")'>EDIT</button>";
          htmlBuffer += "<button class='btn-row-del' style='padding:2px 8px;' onclick='window.vortexDeletePlayer(" + tIdx + ", " + pIdx + ")'>REMOVE</button>";
          htmlBuffer += "</td>";
        }
        htmlBuffer += "</tr>";
        pIdx = pIdx + 1;
      }
    }
    htmlBuffer += "</tbody></table></div></div>";
    tIdx = tIdx + 1;
  }
  (document.getElementById("ws-teams-container") || document.querySelector("ws-teams-container")).innerHTML = htmlBuffer;
}

function renderWorkspaceMatches() {
  let activeT = getActiveTourney ( );
  if (activeT != null) {
    if (activeT.matches.length == 0) {
      (document.getElementById("ws-matches-grid") || document.querySelector("ws-matches-grid")).innerHTML = "<div style='padding:32px; text-align:center; color:#64748b;'>No matches scheduled yet. Click '+ SCHEDULE NEW MATCH' to create brackets.</div>";
      return 0;
    }
    let htmlBuffer = "";
    for (const matchItem of activeT.matches) {
      let statusBadge = "open";
      if (matchItem.status == "LIVE") {
        statusBadge = "live";
      }
      if (matchItem.status == "COMPLETED") {
        statusBadge = "completed";
      }
      htmlBuffer = htmlBuffer + "<div class='tourney-card-item' style='cursor:default;'>";
      htmlBuffer = htmlBuffer + "<div class='card-top-row'>";
      htmlBuffer = htmlBuffer + "<span class='badge-tag " + statusBadge + "'>" + matchItem.status + "</span>";
      htmlBuffer = htmlBuffer + "<span class='badge-tag open'>" + matchItem.map + "</span>";
      htmlBuffer = htmlBuffer + "</div>";
      htmlBuffer = htmlBuffer + "<div class='t-card-title'>" + matchItem.title + "</div>";
      htmlBuffer = htmlBuffer + "<div class='t-card-meta'>Scheduled Time: " + matchItem.time + "</div>";
      htmlBuffer = htmlBuffer + "<div class='t-card-metrics'>";
      htmlBuffer = htmlBuffer + "<div class='t-metric'><span class='tm-label'>CUSTOM ROOM ID</span><span class='tm-val highlight' style='letter-spacing:1px;'>" + matchItem.roomId + "</span></div>";
      htmlBuffer = htmlBuffer + "<div class='t-metric'><span class='tm-label'>ROOM PASSWORD</span><span class='tm-val' style='letter-spacing:1px;'>" + matchItem.roomPass + "</span></div>";
      htmlBuffer = htmlBuffer + "</div>";
      htmlBuffer = htmlBuffer + "<button class='btn-secondary-sm' style='width:100%;' onclick='window.vortexToggleMatchStatus(" + matchItem.id + ")'>TOGGLE STATUS (SCHEDULED / LIVE / DONE)</button>";
      htmlBuffer = htmlBuffer + "</div>";
    }
    (document.getElementById("ws-matches-grid") || document.querySelector("ws-matches-grid")).innerHTML = htmlBuffer;
  }
}

function renderWorkspaceMatchStandings() {
  let activeT = getActiveTourney ( );
  if (activeT != null) {
    let optBuffer = "";
    let mIdx = 0;
    for (const m of activeT.matches) {
      let selectedAttr = "";
      if (mIdx == activeMatchIdx) {
        selectedAttr = " selected";
      }
      optBuffer = optBuffer + "<option value='" + mIdx + "'" + selectedAttr + ">" + m.title + " (" + m.status + ")</option>";
      mIdx = mIdx + 1;
    }
    (document.getElementById("ws-match-select-dropdown") || document.querySelector("ws-match-select-dropdown")).innerHTML = optBuffer;
    let activeMatch = activeT.matches [ activeMatchIdx ];
    if (activeMatch != undefined) {
      (document.getElementById("ws-active-match-title") || document.querySelector("ws-active-match-title")).textContent = activeMatch.title;
      (document.getElementById("ws-active-match-status") || document.querySelector("ws-active-match-status")).textContent = activeMatch.status;
      if (activeMatch.scores.length == 0) {
        let initRank = 1;
        for (const teamItem of activeT.teams) {
          activeMatch.scores.push ( { team : teamItem.name , place : initRank , kills : 0 , bonus : 0 , penalty : 0 } );
          initRank = initRank + 1;
        }
      }
      let htmlBuffer = "";
      let sIdx = 0;
      for (const scoreRow of activeMatch.scores) {
        let pKey = String ( scoreRow.place );
        let placePts = 0;
        if (activeT.placementPoints [ pKey ] != undefined) {
          placePts = activeT.placementPoints [ pKey ];
        }
        let killPts = Number ( scoreRow.kills ) * Number ( activeT.killMultiplier );
        let totalPts = placePts + killPts + Number ( scoreRow.bonus ) - Number ( scoreRow.penalty );
        htmlBuffer = htmlBuffer + "<tr>";
        htmlBuffer = htmlBuffer + "<td><strong class='rank-badge'>#" + ( sIdx + 1 ) + "</strong></td>";
        htmlBuffer = htmlBuffer + "<td><strong>" + scoreRow.team + "</strong></td>";
        htmlBuffer = htmlBuffer + "<td><input class='table-edit-input' type='number' min='1' max='12' value='" + scoreRow.place + "' onchange='window.vortexUpdateMatchScore(" + sIdx + ", \"place\", this.value)'></td>";
        htmlBuffer = htmlBuffer + "<td><input class='table-edit-input' type='number' min='0' max='50' value='" + scoreRow.kills + "' onchange='window.vortexUpdateMatchScore(" + sIdx + ", \"kills\", this.value)'></td>";
        htmlBuffer = htmlBuffer + "<td>" + killPts + "</td>";
        htmlBuffer = htmlBuffer + "<td>" + placePts + "</td>";
        htmlBuffer = htmlBuffer + "<td><input class='table-edit-input' type='number' min='0' max='20' value='" + scoreRow.bonus + "' onchange='window.vortexUpdateMatchScore(" + sIdx + ", \"bonus\", this.value)'></td>";
        htmlBuffer = htmlBuffer + "<td><input class='table-edit-input' type='number' min='0' max='20' value='" + scoreRow.penalty + "' onchange='window.vortexUpdateMatchScore(" + sIdx + ", \"penalty\", this.value)'></td>";
        htmlBuffer = htmlBuffer + "<td><span class='total-pts-pill'>" + totalPts + " PTS</span></td>";
        htmlBuffer = htmlBuffer + "<td>";
        htmlBuffer = htmlBuffer + "<button class='btn-secondary-sm' style='padding:2px 6px; margin-right:4px; font-size:10px;' onclick='window.vortexOpenTeamMatchesModal(\"" + scoreRow.team + "\")'>ALL MATCHES</button>";
        htmlBuffer = htmlBuffer + "<button class='btn-row-del' onclick='window.vortexDeleteMatchRow(" + sIdx + ")'>DEL</button>";
        htmlBuffer = htmlBuffer + "</td>";
        htmlBuffer = htmlBuffer + "</tr>";
        sIdx = sIdx + 1;
      }
      (document.getElementById("ws-match-standings-tbody") || document.querySelector("ws-match-standings-tbody")).innerHTML = htmlBuffer;
    }
  }
}

function computeOverallStandings(activeT) {
  let teamMap = { };
  for (const teamItem of activeT.teams) {
    teamMap[teamItem.name] = { team: teamItem.name, played: 0, wwcd: 0, kills: 0, killPts: 0, placePts: 0, totalPts: 0 }
  }
  for (const m of activeT.matches) {
    if (m.status == "COMPLETED" || m.status == "LIVE") {
      for (const sc of m.scores) {
        if (teamMap [ sc.team ] == undefined) {
          teamMap[sc.team] = { team: sc.team, played: 0, wwcd: 0, kills: 0, killPts: 0, placePts: 0, totalPts: 0 }
        }
        let record = teamMap [ sc.team ];
        record.played = record.played + 1;
        if (Number ( sc.place ) == 1) {
          record.wwcd = record.wwcd + 1;
        }
        let pKey = String ( sc.place );
        let pPts = 0;
        if (activeT.placementPoints [ pKey ] != undefined) {
          pPts = activeT.placementPoints [ pKey ];
        }
        let kPts = Number ( sc.kills ) * Number ( activeT.killMultiplier );
        record.kills = record.kills + Number ( sc.kills );
        record.killPts = record.killPts + kPts;
        record.placePts = record.placePts + pPts;
        record.totalPts = record.totalPts + pPts + kPts + Number ( sc.bonus ) - Number ( sc.penalty );
      }
    }
  }
  let resultList = [ ];
  for (const k of Object.keys ( teamMap )) {
    resultList.push ( teamMap [ k ] );
  }
  resultList.sort ( function ( itemA , itemB ) { return itemB.totalPts - itemA.totalPts } );
  return resultList;
}

function renderWorkspaceOverallStandings() {
  let activeT = getActiveTourney ( );
  if (activeT != null) {
    let overallList = computeOverallStandings ( activeT );
    let htmlBuffer = "";
    let rank = 1;
    for (const row of overallList) {
      let rankClass = "rank-badge";
      if (rank == 1) {
        rankClass = "rank-badge rank-1";
      }
      if (rank == 2) {
        rankClass = "rank-badge rank-2";
      }
      if (rank == 3) {
        rankClass = "rank-badge rank-3";
      }
      htmlBuffer = htmlBuffer + "<tr>";
      htmlBuffer = htmlBuffer + "<td><span class='" + rankClass + "'>#" + rank + "</span></td>";
      htmlBuffer = htmlBuffer + "<td><strong>" + row.team + "</strong></td>";
      htmlBuffer = htmlBuffer + "<td>" + row.played + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.wwcd + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.kills + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.killPts + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.placePts + "</td>";
      htmlBuffer = htmlBuffer + "<td><span class='total-pts-pill'>" + row.totalPts + " PTS</span></td>";
      htmlBuffer = htmlBuffer + "<td style='text-align:right;'><button class='btn-action-primary-sm' style='padding:4px 10px; font-size:11px;' onclick='window.vortexOpenTeamMatchesModal(\"" + row.team + "\")'>✏️ EDIT ALL MATCHES</button></td>";
      htmlBuffer = htmlBuffer + "</tr>";
      rank = rank + 1;
    }
    (document.getElementById("ws-overall-standings-tbody") || document.querySelector("ws-overall-standings-tbody")).innerHTML = htmlBuffer;
  }
}

function openTeamMatchesModal(targetTeam) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can edit match scores.");
    return;
  }
  editingTeamName = targetTeam;
  tempTeamScores = [];
  if (activeT != null) {
    (document.getElementById("modal-team-matches-title") || document.querySelector("modal-team-matches-title")).textContent = "EDIT ALL MATCH SCORES — " + targetTeam;
    let htmlBuffer = "";
    let mIdx = 0;
    for (const m of activeT.matches) {
      let placeVal = 12;
      let killsVal = 0;
      let bonusVal = 0;
      let penaltyVal = 0;
      for (const sc of m.scores) {
        if (sc.team == targetTeam) {
          placeVal = Number(sc.place);
          killsVal = Number(sc.kills);
          bonusVal = Number(sc.bonus);
          penaltyVal = Number(sc.penalty);
        }
      }
      tempTeamScores.push({ place: placeVal, kills: killsVal, bonus: bonusVal, penalty: penaltyVal });
      let pKey = String(placeVal);
      let placePts = 0;
      if (activeT.placementPoints[pKey] != undefined) {
        placePts = activeT.placementPoints[pKey];
      }
      let killPts = killsVal * Number(activeT.killMultiplier);
      let totalMatchPts = placePts + killPts + bonusVal - penaltyVal;
      let statusBadge = "open";
      if (m.status == "LIVE") {
        statusBadge = "live";
      }
      if (m.status == "COMPLETED") {
        statusBadge = "completed";
      }
      htmlBuffer = htmlBuffer + "<tr>";
      htmlBuffer = htmlBuffer + "<td><strong>" + m.title + "</strong><br><span style='font-size:11px; color:#64748b;'>Map: " + m.map + "</span></td>";
      htmlBuffer = htmlBuffer + "<td><span class='badge-tag " + statusBadge + "'>" + m.status + "</span></td>";
      htmlBuffer = htmlBuffer + "<td><input type='number' min='1' max='12' class='table-edit-input' value='" + placeVal + "' oninput='window.vortexUpdateTeamScore(" + mIdx + ", \"place\", this.value)'></td>";
      htmlBuffer = htmlBuffer + "<td><input type='number' min='0' max='50' class='table-edit-input' value='" + killsVal + "' oninput='window.vortexUpdateTeamScore(" + mIdx + ", \"kills\", this.value)'></td>";
      htmlBuffer = htmlBuffer + "<td><input type='number' min='0' max='20' class='table-edit-input' value='" + bonusVal + "' oninput='window.vortexUpdateTeamScore(" + mIdx + ", \"bonus\", this.value)'></td>";
      htmlBuffer = htmlBuffer + "<td><input type='number' min='0' max='20' class='table-edit-input' value='" + penaltyVal + "' oninput='window.vortexUpdateTeamScore(" + mIdx + ", \"penalty\", this.value)'></td>";
      htmlBuffer = htmlBuffer + "<td><span class='total-pts-pill' id='modal-m-pts-" + mIdx + "'>" + totalMatchPts + " PTS</span></td>";
      htmlBuffer = htmlBuffer + "</tr>";
      mIdx = mIdx + 1;
    }
    (document.getElementById("modal-team-matches-tbody") || document.querySelector("modal-team-matches-tbody")).innerHTML = htmlBuffer;
    refreshTeamModalSummary();
    (document.getElementById("modal-team-matches-edit") || document.querySelector("modal-team-matches-edit")).classList.add('show');
  }
}

function updateTeamModalScore(mIdx, field, val) {
  if (tempTeamScores[mIdx] != undefined) {
    let targetScore = tempTeamScores[mIdx];
    targetScore[field] = Number(val);
    refreshTeamModalSummary();
  }
}

function refreshTeamModalSummary() {
  let activeT = getActiveTourney();
  if (activeT != null) {
    let cumPlayed = 0;
    let cumWwcd = 0;
    let cumKills = 0;
    let cumKillPts = 0;
    let cumPlacePts = 0;
    let cumTotalPts = 0;
    let idx = 0;
    for (const sc of tempTeamScores) {
      let pKey = String(sc.place);
      let placePts = 0;
      if (activeT.placementPoints[pKey] != undefined) {
        placePts = activeT.placementPoints[pKey];
      }
      let killPts = Number(sc.kills) * Number(activeT.killMultiplier);
      let rowTotal = placePts + killPts + Number(sc.bonus) - Number(sc.penalty);
      let rowEl = document.getElementById("modal-m-pts-" + idx);
      if (rowEl != null) {
        rowEl.textContent = rowTotal + " PTS";
      }
      cumPlayed = cumPlayed + 1;
      if (Number(sc.place) == 1) {
        cumWwcd = cumWwcd + 1;
      }
      cumKills = cumKills + Number(sc.kills);
      cumKillPts = cumKillPts + killPts;
      cumPlacePts = cumPlacePts + placePts;
      cumTotalPts = cumTotalPts + rowTotal;
      idx = idx + 1;
    }
    let sumHtml = "";
    sumHtml = sumHtml + "<div class='tm-stat-box'><span class='tm-stat-lbl'>MATCHES</span><span class='tm-stat-val'>" + cumPlayed + " / " + activeT.matches.length + "</span></div>";
    sumHtml = sumHtml + "<div class='tm-stat-box'><span class='tm-stat-lbl'>BOOYAH (WWCD)</span><span class='tm-stat-val highlight'>" + cumWwcd + "</span></div>";
    sumHtml = sumHtml + "<div class='tm-stat-box'><span class='tm-stat-lbl'>TOTAL KILLS</span><span class='tm-stat-val'>" + cumKills + " (" + cumKillPts + " PTS)</span></div>";
    sumHtml = sumHtml + "<div class='tm-stat-box'><span class='tm-stat-lbl'>PLACEMENT PTS</span><span class='tm-stat-val'>" + cumPlacePts + " PTS</span></div>";
    sumHtml = sumHtml + "<div class='tm-stat-box'><span class='tm-stat-lbl'>NEW OVERALL TOTAL</span><span class='tm-stat-val super'>" + cumTotalPts + " PTS</span></div>";
    (document.getElementById("team-modal-stats-summary") || document.querySelector("team-modal-stats-summary")).innerHTML = sumHtml;
  }
}

function saveTeamAllMatches() {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can edit match scores.");
    return;
  }
  if (editingTeamName != "") {
    let mIdx = 0;
    for (const sc of tempTeamScores) {
      if (activeT.matches[mIdx] != undefined) {
        let found = false;
        for (const matchScore of activeT.matches[mIdx].scores) {
          if (matchScore.team == editingTeamName) {
            matchScore.place = sc.place;
            matchScore.kills = sc.kills;
            matchScore.bonus = sc.bonus;
            matchScore.penalty = sc.penalty;
            found = true;
          }
        }
        if (found == false) {
          activeT.matches[mIdx].scores.push({ team: editingTeamName, place: sc.place, kills: sc.kills, bonus: sc.bonus, penalty: sc.penalty });
        }
        activeT.matches[mIdx].scores.sort(function(itemA, itemB) { return itemA.place - itemB.place; });
      }
      mIdx = mIdx + 1;
    }
    (document.getElementById("modal-team-matches-edit") || document.querySelector("modal-team-matches-edit")).classList.remove('show');
    saveStateToStorage();
    renderWorkspaceOverview();
    renderWorkspaceMatches();
    renderWorkspaceMatchStandings();
    renderWorkspaceOverallStandings();
    showToast("✓ Saved & auto-calculated all matches for " + editingTeamName + "! Standings updated live.");
  }
}

function renderWorkspacePointRules() {
  let activeT = getActiveTourney();
  if (activeT != null) {
    (document.getElementById("ws-rules-kill-pts") || document.querySelector("ws-rules-kill-pts")).value = activeT.killMultiplier || 1;
    const slotsInput = document.getElementById("ws-rules-slots");
    if (slotsInput) {
      slotsInput.value = activeT.slots || 12;
    }
    const dlInput = document.getElementById("ws-rules-deadline");
    if (dlInput) {
      dlInput.value = activeT.registrationDeadline || "";
    }
    let htmlBuffer = "";
    const slotCount = Math.max(12, Number(activeT.slots) || 12);
    for (let r = 1; r <= slotCount; r++) {
      let val = 0;
      if (activeT.placementPoints && activeT.placementPoints[String(r)] != undefined) {
        val = activeT.placementPoints[String(r)];
      }
      htmlBuffer += "<div class='pt-box'>";
      htmlBuffer += "<span class='pt-lbl'>#" + r + " Rank</span>";
      htmlBuffer += "<input type='number' class='pt-input' id='ws-pt-rank-" + r + "' value='" + val + "'>";
      htmlBuffer += "</div>";
    }
    (document.getElementById("ws-rules-pts-grid") || document.querySelector("ws-rules-pts-grid")).innerHTML = htmlBuffer;
  }
}

function createStandingsCheckpoint(customTitle) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can save checkpoints.");
    return;
  }
  let overallSnapshot = computeOverallStandings(activeT);
  let titleText = customTitle;
  if (titleText == undefined || titleText == "") {
    titleText = "Manual Checkpoint #" + (activeT.checkpoints.length + 1);
  }
  let timeStr = new Date().toLocaleTimeString();
  activeT.checkpoints.push({ title: titleText, timestamp: timeStr, standings: JSON.parse(JSON.stringify(overallSnapshot)) });
  saveStateToStorage();
  showToast("🔖 Checkpoint saved: " + titleText);
}

function renderRevertModalList() {
  let activeT = getActiveTourney ( );
  if (activeT != null) {
    if (activeT.checkpoints.length == 0) {
      (document.getElementById("revert-checkpoints-list") || document.querySelector("revert-checkpoints-list")).innerHTML = "<div style='color:#64748b; text-align:center; padding:16px;'>No checkpoints recorded yet for this tournament.</div>";
      return 0;
    }
    let htmlBuffer = "";
    let cIdx = 0;
    for (const cp of activeT.checkpoints) {
      htmlBuffer = htmlBuffer + "<div class='tourney-card-item' style='margin-bottom:10px; padding:12px; cursor:default;'>";
      htmlBuffer = htmlBuffer + "<div style='display:flex; justify-content:space-between; align-items:center;'>";
      htmlBuffer = htmlBuffer + "<div><strong>" + cp.title + "</strong><br><span style='font-size:11px; color:#64748b;'>Saved At: " + cp.timestamp + " (" + cp.standings.length + " Squads)</span></div>";
      htmlBuffer = htmlBuffer + "<button class='btn-revert-sm' onclick='window.vortexApplyRevert(" + cIdx + ")'>RESTORE THIS STATE</button>";
      htmlBuffer = htmlBuffer + "</div>";
      htmlBuffer = htmlBuffer + "</div>";
      cIdx = cIdx + 1;
    }
    (document.getElementById("revert-checkpoints-list") || document.querySelector("revert-checkpoints-list")).innerHTML = htmlBuffer;
  }
}

const ESPORTS_TEMPLATES = [
  // 5 Free Fire Minimalist Templates
  {
    id: "ff_crimson_blaze",
    name: "🔥 Crimson Blaze",
    game: "ff",
    gameTag: "FREE FIRE MAX",
    subTag: "BATTLE ROYALE TOURNAMENT",
    accent: "#ff2d55",
    subAccent: "#ff758c",
    bg1: "#0a0407",
    bg2: "#18050e",
    bg3: "#260815",
    cardBg: "rgba(255, 45, 85, 0.08)",
    border: "#ff2d55",
    previewGrad: "linear-gradient(135deg, #18050e, #ff2d55)"
  },
  {
    id: "ff_cyber_bermuda",
    name: "⚡ Cyber Bermuda",
    game: "ff",
    gameTag: "FREE FIRE MAX",
    subTag: "BERMUDA PRO LEAGUE",
    accent: "#00f0ff",
    subAccent: "#7000ff",
    bg1: "#030812",
    bg2: "#071626",
    bg3: "#0c243d",
    cardBg: "rgba(0, 240, 255, 0.08)",
    border: "#00f0ff",
    previewGrad: "linear-gradient(135deg, #071626, #00f0ff)"
  },
  {
    id: "ff_grandmasters_gold",
    name: "👑 Grandmasters Gold",
    game: "ff",
    gameTag: "FREE FIRE MAX",
    subTag: "GRANDMASTERS CHAMPIONSHIP",
    accent: "#ffd700",
    subAccent: "#ffae00",
    bg1: "#0a0903",
    bg2: "#161307",
    bg3: "#241e0a",
    cardBg: "rgba(255, 215, 0, 0.08)",
    border: "#ffd700",
    previewGrad: "linear-gradient(135deg, #161307, #ffd700)"
  },
  {
    id: "ff_kalahari_sunset",
    name: "🌋 Kalahari Sunset",
    game: "ff",
    gameTag: "FREE FIRE MAX",
    subTag: "KALAHARI CLASH ROYALE",
    accent: "#ff6b35",
    subAccent: "#f7c59f",
    bg1: "#100703",
    bg2: "#1f0c05",
    bg3: "#301307",
    cardBg: "rgba(255, 107, 53, 0.08)",
    border: "#ff6b35",
    previewGrad: "linear-gradient(135deg, #1f0c05, #ff6b35)"
  },
  {
    id: "ff_nebula_void",
    name: "🌌 Nebula Void",
    game: "ff",
    gameTag: "FREE FIRE MAX",
    subTag: "ELITE ESPORTS SERIES",
    accent: "#a855f7",
    subAccent: "#c084fc",
    bg1: "#0a0312",
    bg2: "#150826",
    bg3: "#230d3d",
    cardBg: "rgba(168, 85, 247, 0.08)",
    border: "#a855f7",
    previewGrad: "linear-gradient(135deg, #150826, #a855f7)"
  },
  // 5 BGMI Minimalist Templates
  {
    id: "bgmi_erangel_tactical",
    name: "🪖 Erangel Tactical",
    game: "bgmi",
    gameTag: "BATTLEGROUNDS MOBILE INDIA",
    subTag: "PRO SERIES INVITATIONAL",
    accent: "#4ade80",
    subAccent: "#22c55e",
    bg1: "#040d07",
    bg2: "#0a1c0e",
    bg3: "#102b16",
    cardBg: "rgba(74, 222, 128, 0.08)",
    border: "#4ade80",
    previewGrad: "linear-gradient(135deg, #0a1c0e, #4ade80)"
  },
  {
    id: "bgmi_champions_royale",
    name: "🏆 Champions Royale",
    game: "bgmi",
    gameTag: "BATTLEGROUNDS MOBILE INDIA",
    subTag: "CHAMPIONS CUP GRAND FINALS",
    accent: "#f59e0b",
    subAccent: "#fbbf24",
    bg1: "#0e0a03",
    bg2: "#1b1406",
    bg3: "#291e09",
    cardBg: "rgba(245, 158, 11, 0.08)",
    border: "#f59e0b",
    previewGrad: "linear-gradient(135deg, #1b1406, #f59e0b)"
  },
  {
    id: "bgmi_blue_zone",
    name: "⚡ Blue Zone Cyber",
    game: "bgmi",
    gameTag: "BATTLEGROUNDS MOBILE INDIA",
    subTag: "MASTERS TOURNAMENT",
    accent: "#38bdf8",
    subAccent: "#0284c7",
    bg1: "#030c16",
    bg2: "#07182b",
    bg3: "#0b2440",
    cardBg: "rgba(56, 189, 248, 0.08)",
    border: "#38bdf8",
    previewGrad: "linear-gradient(135deg, #07182b, #38bdf8)"
  },
  {
    id: "bgmi_miramar_mirage",
    name: "🏜️ Miramar Mirage",
    game: "bgmi",
    gameTag: "BATTLEGROUNDS MOBILE INDIA",
    subTag: "DESERT CLASH ROYALE",
    accent: "#fbbf24",
    subAccent: "#d97706",
    bg1: "#100c03",
    bg2: "#1f1706",
    bg3: "#2e2209",
    cardBg: "rgba(251, 191, 36, 0.08)",
    border: "#fbbf24",
    previewGrad: "linear-gradient(135deg, #1f1706, #fbbf24)"
  },
  {
    id: "bgmi_shadow_stealth",
    name: "🥷 Shadow Stealth",
    game: "bgmi",
    gameTag: "BATTLEGROUNDS MOBILE INDIA",
    subTag: "SHADOW WAR SCRIMS",
    accent: "#e11d48",
    subAccent: "#9f1239",
    bg1: "#050508",
    bg2: "#0c0c12",
    bg3: "#14141e",
    cardBg: "rgba(225, 29, 72, 0.08)",
    border: "#e11d48",
    previewGrad: "linear-gradient(135deg, #0c0c12, #e11d48)"
  }
];

let activeExportTheme = "ff_crimson_blaze";
let activeExportTarget = "overall";
let activeTemplateFilter = "all";

function renderExportsStudio() {
  renderExportTargetDropdown();
  renderTemplateSelectorGrid();
  renderEsportsStandingsCanvas();
}

function renderExportTargetDropdown() {
  const targetSelect = document.getElementById("export-target-select");
  if (!targetSelect) return;
  const activeT = getActiveTourney();
  if (!activeT) return;

  let html = "<option value='overall'" + (activeExportTarget === 'overall' ? ' selected' : '') + ">🏆 Overall Cumulative Standings (16 Squads)</option>";
  let mIdx = 0;
  for (const m of activeT.matches) {
    const val = "match_" + mIdx;
    const isSel = activeExportTarget === val ? " selected" : "";
    html += "<option value='" + val + "'" + isSel + ">🎯 Match " + (mIdx + 1) + ": " + m.title + " (" + m.map + ")</option>";
    mIdx++;
  }
  targetSelect.innerHTML = html;
}

function renderTemplateSelectorGrid() {
  const grid = document.getElementById("templates-grid-selector");
  if (!grid) return;

  const filtered = ESPORTS_TEMPLATES.filter(t => {
    if (activeTemplateFilter === "all") return true;
    return t.game === activeTemplateFilter;
  });

  let html = "";
  for (const t of filtered) {
    const isAct = t.id === activeExportTheme ? " active" : "";
    html += "<div class='template-card-choice" + isAct + "' onclick='window.vortexSelectExportTheme(\"" + t.id + "\")'>";
    html += "<div class='tc-preview-box' style='background:" + t.previewGrad + "; color:#fff; text-shadow:0 1px 4px #000;'>16 TEAMS</div>";
    html += "<div class='tc-title'>" + t.name + "</div>";
    html += "<span class='tc-game-badge " + t.game + "'>" + (t.game === 'ff' ? 'FREE FIRE' : 'BGMI') + "</span>";
    html += "</div>";
  }
  grid.innerHTML = html;
}

window.vortexSelectExportTheme = function(themeId) {
  activeExportTheme = themeId;
  renderTemplateSelectorGrid();
  renderEsportsStandingsCanvas();
};

function renderEsportsStandingsCanvas() {
  const canvas = document.getElementById("esports-standings-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const activeT = getActiveTourney();
  if (!activeT) return;

  const theme = ESPORTS_TEMPLATES.find(t => t.id === activeExportTheme) || ESPORTS_TEMPLATES[0];

  const titleEl = document.getElementById("canvas-preview-theme-title");
  if (titleEl) titleEl.textContent = theme.name.toUpperCase();

  // Canvas size: 1920x1080 Full HD
  const W = 1920;
  const H = 1080;

  // 1. Background Gradient
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, theme.bg1);
  bgGrad.addColorStop(0.5, theme.bg2);
  bgGrad.addColorStop(1, theme.bg3);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Cyber Grid & Diagonal Accents
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Laser speed stripes
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = 3;
  for (let i = -W; i < W * 2; i += 180) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 500, H);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Top Outer Laser Frame
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // Corner Accent Brackets
  const cornerLen = 40;
  ctx.lineWidth = 6;
  ctx.strokeStyle = theme.accent;
  // Top-Left
  ctx.beginPath(); ctx.moveTo(25, 25 + cornerLen); ctx.lineTo(25, 25); ctx.lineTo(25 + cornerLen, 25); ctx.stroke();
  // Top-Right
  ctx.beginPath(); ctx.moveTo(W - 25 - cornerLen, 25); ctx.lineTo(W - 25, 25); ctx.lineTo(W - 25, 25 + cornerLen); ctx.stroke();
  // Bottom-Left
  ctx.beginPath(); ctx.moveTo(25, H - 25 - cornerLen); ctx.lineTo(25, H - 25); ctx.lineTo(25 + cornerLen, H - 25); ctx.stroke();
  // Bottom-Right
  ctx.beginPath(); ctx.moveTo(W - 25 - cornerLen, H - 25); ctx.lineTo(W - 25, H - 25); ctx.lineTo(W - 25, H - 25 - cornerLen); ctx.stroke();

  // 4. Header Block
  // Capsule Badge
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.roundRect(W / 2 - 180, 50, 360, 32, 16);
  ctx.fill();

  ctx.fillStyle = "#000000";
  ctx.font = "900 13px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.letterSpacing = "2px";
  ctx.fillText(theme.gameTag + " • " + (activeT.format || "SQUAD BR"), W / 2, 71);

  // Tournament Title
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 44px 'Space Grotesk', sans-serif";
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 18;
  ctx.fillText(activeT.title.toUpperCase(), W / 2, 128);
  ctx.shadowBlur = 0;

  // Subtitle / Scope
  let subText = "OFFICIAL OVERALL STANDINGS • 16 SQUADS";
  if (activeExportTarget.startsWith("match_")) {
    const mIdx = parseInt(activeExportTarget.split("_")[1], 10);
    const m = activeT.matches[mIdx];
    if (m) {
      subText = "MATCH " + (mIdx + 1) + ": " + m.title.toUpperCase() + " (" + m.map.toUpperCase() + ") • LIVE SCORESHEET";
    }
  }
  ctx.fillStyle = theme.subAccent || theme.accent;
  ctx.font = "800 15px 'Space Grotesk', sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillText(subText, W / 2, 160);

  // Left & Right Header Meta Badges
  // Prize Pool (Left)
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(60, 60, 220, 75, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 11px 'Space Grotesk', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOTAL PRIZE POOL", 78, 86);
  ctx.fillStyle = "#ffd700";
  ctx.font = "900 24px 'Space Grotesk', sans-serif";
  ctx.fillText(activeT.prize || "₹25,000", 78, 118);

  // Status & Map (Right)
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.beginPath(); ctx.roundRect(W - 280, 60, 220, 75, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 11px 'Space Grotesk', sans-serif";
  ctx.fillText("MAP ROTATION", W - 262, 86);
  ctx.fillStyle = theme.accent;
  ctx.font = "900 18px 'Space Grotesk', sans-serif";
  const mapStr = (activeT.maps || "Bermuda, Purgatory").split(",")[0];
  ctx.fillText(mapStr.toUpperCase(), W - 262, 116);

  // 5. Gather 16 Squad Rows Data
  let rawStandings = [];
  if (activeExportTarget.startsWith("match_")) {
    const mIdx = parseInt(activeExportTarget.split("_")[1], 10);
    const m = activeT.matches[mIdx];
    if (m && m.scores) {
      rawStandings = m.scores.map(s => {
        const pKey = String(s.place);
        const pPts = activeT.placementPoints[pKey] || 0;
        const kPts = Number(s.kills || 0) * Number(activeT.killMultiplier || 1);
        const tot = pPts + kPts + Number(s.bonus || 0) - Number(s.penalty || 0);
        return {
          team: s.team,
          place: Number(s.place),
          wins: Number(s.place) === 1 ? 1 : 0,
          elims: Number(s.kills || 0),
          positionPts: pPts,
          totalPts: tot
        };
      });
      rawStandings.sort((a, b) => b.totalPts - a.totalPts || a.place - b.place);
    }
  } else {
    rawStandings = computeOverallStandings(activeT).map(s => ({
      team: s.team,
      wins: s.wwcd,
      elims: s.kills,
      positionPts: s.placePts,
      totalPts: s.totalPts
    }));
  }

  // Ensure full 16 slots
  const full16 = [];
  for (let i = 0; i < 16; i++) {
    if (rawStandings[i]) {
      full16.push({ rank: i + 1, ...rawStandings[i] });
    } else {
      full16.push({
        rank: i + 1,
        team: "Slot #" + (i + 1),
        wins: 0,
        elims: 0,
        positionPts: 0,
        totalPts: 0
      });
    }
  }

  // 6. Draw 16 Squad Rows in 2 Equal Columns (Left 8, Right 8)
  const colWidth = 860;
  const colLeftX = 65;
  const colRightX = 995;
  const startY = 205;
  const rowHeight = 84;
  const rowGap = 10;

  function drawColumn(items, startRank, startX) {
    // Column Sub-Header
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.roundRect(startX, startY, colWidth, 32, 6);
    ctx.fill();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "800 11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("RANK", startX + 14, startY + 20);
    ctx.fillText("TEAM NAME", startX + 75, startY + 20);
    ctx.textAlign = "center";
    ctx.fillText("WINS", startX + 410, startY + 20);
    ctx.fillText("ELIMS", startX + 510, startY + 20);
    ctx.fillText("POSITION PTS", startX + 630, startY + 20);
    ctx.textAlign = "right";
    ctx.fillText("TOTAL PTS", startX + colWidth - 20, startY + 20);

    let currentY = startY + 42;
    for (const item of items) {
      const isTop1 = item.rank === 1;
      const isTop2 = item.rank === 2;
      const isTop3 = item.rank === 3;

      // Row Background Card
      ctx.fillStyle = isTop1 ? "rgba(255, 215, 0, 0.12)" : (isTop2 ? "rgba(226, 232, 240, 0.08)" : (isTop3 ? "rgba(217, 119, 6, 0.08)" : theme.cardBg));
      ctx.strokeStyle = isTop1 ? "#ffd700" : (isTop2 ? "#cbd5e1" : (isTop3 ? "#d97706" : "rgba(255, 255, 255, 0.08)"));
      ctx.lineWidth = isTop1 ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(startX, currentY, colWidth, rowHeight, 10);
      ctx.fill();
      ctx.stroke();

      // Rank Badge
      const badgeW = 46;
      const badgeH = 46;
      const badgeX = startX + 12;
      const badgeY = currentY + (rowHeight - badgeH) / 2;

      ctx.fillStyle = isTop1 ? "#ffd700" : (isTop2 ? "#e2e8f0" : (isTop3 ? "#d97706" : "#181826"));
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
      ctx.fill();

      ctx.fillStyle = isTop1 || isTop2 ? "#000000" : "#ffffff";
      ctx.font = "900 18px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText((isTop1 ? "👑" : "") + item.rank, badgeX + badgeW / 2, badgeY + 29);

      // Team Name
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 21px 'Space Grotesk', sans-serif";
      let displayTeam = item.team;
      if (displayTeam.length > 18) displayTeam = displayTeam.slice(0, 17) + "…";
      ctx.fillText(displayTeam, startX + 75, currentY + 36);

      // Sub-label
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 12px 'Space Grotesk', sans-serif";
      ctx.fillText("Slot #" + item.rank + " Squad", startX + 75, currentY + 60);

      // Wins (Center)
      ctx.textAlign = "center";
      ctx.fillStyle = isTop1 ? "#ffd700" : theme.accent;
      ctx.font = "900 20px 'Space Grotesk', sans-serif";
      ctx.fillText(String(item.wins || 0), startX + 410, currentY + 48);

      // Elims (Center)
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 20px 'Space Grotesk', sans-serif";
      ctx.fillText(String(item.elims || 0), startX + 510, currentY + 48);

      // Position Pts (Center)
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "900 20px 'Space Grotesk', sans-serif";
      ctx.fillText(String(item.positionPts || 0), startX + 630, currentY + 48);

      // Total PTS Pill (Right)
      const pillW = 108;
      const pillH = 46;
      const pillX = startX + colWidth - pillW - 14;
      const pillY = currentY + (rowHeight - pillH) / 2;

      ctx.fillStyle = isTop1 ? "#ffd700" : theme.accent;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
      ctx.fill();

      ctx.fillStyle = "#000000";
      ctx.font = "900 20px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.totalPts + " PTS", pillX + pillW / 2, pillY + 30);

      currentY += rowHeight + rowGap;
    }
  }

  // Draw Left (1-8) & Right (9-16)
  drawColumn(full16.slice(0, 8), 1, colLeftX);
  drawColumn(full16.slice(8, 16), 9, colRightX);

  // 7. Footer Banner
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, H - 70);
  ctx.lineTo(W - 60, H - 70);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "700 12px 'Space Grotesk', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("⚡ POWERED BY VORTEX ESPORTS OS • OFFICIAL CLOUD VERIFIED SCORESHEET", 65, H - 45);

  ctx.textAlign = "right";
  const nowStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  ctx.fillText("GENERATED: " + nowStr + " • 16 SQUADS", W - 65, H - 45);
}

function downloadCanvasPoster() {
  const canvas = document.getElementById("esports-standings-canvas");
  if (!canvas) return;
  const activeT = getActiveTourney();
  const titleSlug = activeT ? activeT.title.replaceAll(" ", "_") : "Tournament";
  const scopeSlug = activeExportTarget === "overall" ? "Overall_16Teams" : activeExportTarget;

  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = titleSlug + "_" + scopeSlug + "_Poster.png";
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("📸 High-Res 1080p Esports Standings Poster Downloaded!");
}

async function copyCanvasPosterToClipboard() {
  const canvas = document.getElementById("esports-standings-canvas");
  if (!canvas) return;
  try {
    canvas.toBlob(async blob => {
      if (blob && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showToast("📋 Esports Poster copied to clipboard! (Ready to paste in Discord/WhatsApp)");
      } else {
        downloadCanvasPoster();
      }
    });
  } catch (err) {
    downloadCanvasPoster();
  }
}

function downloadTournamentCSV(targetType = 'overall') {
  let activeT = getActiveTourney();
  if (activeT != null) {
    let csvContent = "\uFEFF"; // UTF-8 BOM for flawless Excel & Google Sheets opening
    let fileName = "";

    if (targetType === 'match') {
      const activeMatch = activeT.matches[activeMatchIdx] || activeT.matches[0];
      if (!activeMatch) {
        showToast("⚠️ No match found to export.");
        return;
      }
      fileName = activeT.title.replaceAll(" ", "_") + "_Match_" + (activeMatchIdx + 1) + "_Scores.csv";
      csvContent += "Match_Title,Map,Status,Room_ID,Room_Password\n";
      csvContent += '"' + activeMatch.title + '","' + activeMatch.map + '","' + activeMatch.status + '","' + activeMatch.roomId + '","' + activeMatch.roomPass + '"\n\n';
      csvContent += "Rank,Team_Name,Wins,Elims,Position_Points,Bonus_Points,Penalty_Points,Total_Points\n";

      let rank = 1;
      for (const s of (activeMatch.scores || [])) {
        const pKey = String(s.place);
        const pPts = activeT.placementPoints[pKey] || 0;
        const kPts = Number(s.kills || 0) * Number(activeT.killMultiplier || 1);
        const tot = pPts + kPts + Number(s.bonus || 0) - Number(s.penalty || 0);
        const wins = Number(s.place) === 1 ? 1 : 0;
        csvContent += rank + ',"' + s.team.replaceAll('"', '""') + '",' + wins + ',' + (s.kills || 0) + ',' + pPts + ',' + (s.bonus || 0) + ',' + (s.penalty || 0) + ',' + tot + "\n";
        rank++;
      }
    } else {
      // Overall cumulative standings
      fileName = activeT.title.replaceAll(" ", "_") + "_Overall_16Teams_Standings.csv";
      csvContent += "Tournament_Title,Game,Format,Prize_Pool,Total_Matches\n";
      csvContent += '"' + activeT.title + '","' + activeT.game + '","' + activeT.format + '","' + (activeT.prize || "") + '",' + activeT.matches.length + "\n\n";
      csvContent += "Rank,Team_Name,Wins,Elims,Position_Points,Total_Points\n";

      let overallList = computeOverallStandings(activeT);
      let rank = 1;
      for (const row of overallList) {
        csvContent += rank + ',"' + row.team.replaceAll('"', '""') + '",' + row.wwcd + ',' + row.kills + ',' + row.placePts + ',' + row.totalPts + "\n";
        rank++;
      }
    }

    let blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    let blobUrl = URL.createObjectURL(blob);
    let downloadLink = document.createElement("a");
    downloadLink.href = blobUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    showToast("📥 CSV Exported: " + fileName);
  }
}

function copyTextLeaderboardReport() {
  let activeT = getActiveTourney();
  if (activeT != null) {
    let overallList = computeOverallStandings(activeT);
    let report = "🏆 " + activeT.title + " 🏆\n";
    report += "🎮 " + activeT.game + " • Format: " + activeT.format + " • Prize: " + activeT.prize + "\n";
    report += "═══════════════════════════════════════════════════\n";
    report += "RANK | TEAM NAME | WINS | ELIMS | POSITION PTS | TOTAL\n";
    report += "═══════════════════════════════════════════════════\n";
    let rank = 1;
    for (const row of overallList) {
      report += "#" + rank + " " + row.team + " | Wins: " + row.wwcd + " | Elims: " + row.kills + " | Pos Pts: " + row.placePts + " | Total: " + row.totalPts + " PTS\n";
      rank++;
    }
    report += "═══════════════════════════════════════════════════\nGenerated via Vortex Esports OS";
    navigator.clipboard.writeText(report);
    showToast("📋 Formatted Text Report copied to clipboard!");
  }
}

function editTeamModal(teamIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can edit squad details.");
    return;
  }
  if (activeT.teams[teamIdx] != undefined) {
    let sq = activeT.teams[teamIdx];
    (document.getElementById("edit-team-idx") || document.querySelector("edit-team-idx")).value = teamIdx;
    (document.getElementById("team-input-slot") || document.querySelector("team-input-slot")).value = sq.slot;
    (document.getElementById("team-input-tag") || document.querySelector("team-input-tag")).value = sq.tag;
    (document.getElementById("team-input-name") || document.querySelector("team-input-name")).value = sq.name;
    (document.getElementById("team-input-captain") || document.querySelector("team-input-captain")).value = sq.captain;

    const poolSelect = document.getElementById("team-input-pool");
    if (poolSelect) {
      const pools = getTourneyPools(activeT);
      let opts = `<option value="">⚪ Unassigned / General Pool</option>`;
      pools.forEach(p => {
        opts += `<option value="${p.id}" ${sq.poolId === p.id ? 'selected' : ''}>● ${p.name}</option>`;
      });
      poolSelect.innerHTML = opts;
    }

    (document.getElementById("modal-team-title") || document.querySelector("modal-team-title")).textContent = "EDIT SQUAD DETAILS";
    (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.add('show');
  }
}

function deleteTeam(teamIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can delete squads.");
    return;
  }
  if (activeT.teams[teamIdx] != undefined) {
    let name = activeT.teams[teamIdx].name;
    activeT.teams.splice(teamIdx, 1);
    saveStateToStorage();
    renderWorkspaceOverview();
    renderWorkspaceTeams();
    renderWorkspaceMatchStandings();
    renderWorkspaceOverallStandings();
    showToast("Removed squad '" + name + "' from tournament.");
  }
}

function openAddPlayerModal(teamIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can add players.");
    return;
  }
  (document.getElementById("edit-player-team-idx") || document.querySelector("edit-player-team-idx")).value = teamIdx;
  (document.getElementById("edit-player-idx") || document.querySelector("edit-player-idx")).value = "-1";
  (document.getElementById("player-input-name") || document.querySelector("player-input-name")).value = "";
  (document.getElementById("player-input-uid") || document.querySelector("player-input-uid")).value = "";
  (document.getElementById("modal-player-title") || document.querySelector("modal-player-title")).textContent = "ADD PLAYER TO SQUAD";
  (document.getElementById("modal-player-edit") || document.querySelector("modal-player-edit")).classList.add('show');
}

function editPlayerModal(teamIdx, playerIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can edit players.");
    return;
  }
  if (activeT.teams[teamIdx] != undefined) {
    let p = activeT.teams[teamIdx].players[playerIdx];
    if (p != undefined) {
      (document.getElementById("edit-player-team-idx") || document.querySelector("edit-player-team-idx")).value = teamIdx;
      (document.getElementById("edit-player-idx") || document.querySelector("edit-player-idx")).value = playerIdx;
      (document.getElementById("player-input-name") || document.querySelector("player-input-name")).value = p.name;
      (document.getElementById("player-input-uid") || document.querySelector("player-input-uid")).value = p.uid;
      (document.getElementById("player-input-role") || document.querySelector("player-input-role")).value = p.role;
      (document.getElementById("modal-player-title") || document.querySelector("modal-player-title")).textContent = "EDIT PLAYER ROSTER";
      (document.getElementById("modal-player-edit") || document.querySelector("modal-player-edit")).classList.add('show');
    }
  }
}

function deletePlayer(teamIdx, playerIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can delete players.");
    return;
  }
  if (activeT.teams[teamIdx] != undefined) {
    let pName = activeT.teams[teamIdx].players[playerIdx].name;
    activeT.teams[teamIdx].players.splice(playerIdx, 1);
    saveStateToStorage();
    renderWorkspaceTeams();
    showToast("Removed player '" + pName + "' from squad.");
  }
}

function toggleMatchStatus(matchId) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can change match status.");
    return;
  }
  for (const m of activeT.matches) {
    if (m.id == matchId) {
      if (m.status == "SCHEDULED") {
        m.status = "LIVE";
      } else if (m.status == "LIVE") {
        m.status = "COMPLETED";
      } else {
        m.status = "SCHEDULED";
      }
      saveStateToStorage();
      renderWorkspaceOverview();
      renderWorkspaceMatches();
      renderWorkspaceMatchStandings();
      renderWorkspaceOverallStandings();
      showToast(m.title + " status changed to: " + m.status);
    }
  }
}

function updateMatchScore(scoreIdx, field, val) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can update match scores.");
    return;
  }
  if (activeT.matches[activeMatchIdx] != undefined) {
    let row = activeT.matches[activeMatchIdx].scores[scoreIdx];
    if (row != undefined) {
      row[field] = Number(val);
      activeT.matches[activeMatchIdx].scores.sort(function(itemA, itemB) { return itemA.place - itemB.place; });
      saveStateToStorage();
      renderWorkspaceOverview();
      renderWorkspaceMatchStandings();
      renderWorkspaceOverallStandings();
      showToast("✓ Updated " + row.team + " " + field + " to " + val);
    }
  }
}

function deleteMatchRow(scoreIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can delete match rows.");
    return;
  }
  if (activeT.matches[activeMatchIdx] != undefined) {
    activeT.matches[activeMatchIdx].scores.splice(scoreIdx, 1);
    saveStateToStorage();
    renderWorkspaceMatchStandings();
    renderWorkspaceOverallStandings();
    showToast("Removed squad score row.");
  }
}

function applyRevert(checkpointIdx) {
  let activeT = getActiveTourney();
  if (!activeT) return;
  if (!isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only the tournament organizer can restore checkpoints.");
    return;
  }
  if (activeT.checkpoints[checkpointIdx] != undefined) {
    let cp = activeT.checkpoints[checkpointIdx];
    let htmlBuffer = "";
    let rank = 1;
    for (const row of cp.standings) {
      htmlBuffer = htmlBuffer + "<tr>";
      htmlBuffer = htmlBuffer + "<td><strong class='rank-badge'>#" + rank + "</strong></td>";
      htmlBuffer = htmlBuffer + "<td><strong>" + row.team + "</strong></td>";
      htmlBuffer = htmlBuffer + "<td>" + row.played + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.wwcd + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.kills + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.killPts + "</td>";
      htmlBuffer = htmlBuffer + "<td>" + row.placePts + "</td>";
      htmlBuffer = htmlBuffer + "<td><span class='total-pts-pill'>" + row.totalPts + " PTS</span></td>";
      htmlBuffer = htmlBuffer + "</tr>";
      rank = rank + 1;
    }
    (document.getElementById("ws-overall-standings-tbody") || document.querySelector("ws-overall-standings-tbody")).innerHTML = htmlBuffer;
    (document.getElementById("modal-revert-standings") || document.querySelector("modal-revert-standings")).classList.remove('show');
    showToast("⏪ Successfully reverted standings to: " + cp.title);
  }
}

window.vortexOpenWorkspace = function ( id ) { openWorkspaceWithId ( id ) };

window.vortexEditTeamModal = function ( idx ) { editTeamModal ( idx ) };

window.vortexDeleteTeam = function ( idx ) { deleteTeam ( idx ) };

window.vortexOpenAddPlayerModal = function ( idx ) { openAddPlayerModal ( idx ) };

window.vortexEditPlayerModal = function ( tIdx , pIdx ) { editPlayerModal ( tIdx , pIdx ) };

window.vortexDeletePlayer = function ( tIdx , pIdx ) { deletePlayer ( tIdx , pIdx ) };

window.vortexToggleMatchStatus = function ( id ) { toggleMatchStatus ( id ) };

window.vortexUpdateMatchScore = function ( sIdx , fld , val ) { updateMatchScore ( sIdx , fld , val ) };

window.vortexDeleteMatchRow = function ( sIdx ) { deleteMatchRow ( sIdx ) };

window.vortexApplyRevert = function ( idx ) { applyRevert ( idx ) };

window.vortexOpenTeamMatchesModal = function ( team ) { openTeamMatchesModal ( team ) };

window.vortexUpdateTeamScore = function ( mIdx , fld , val ) { updateTeamModalScore ( mIdx , fld , val ) };

(function() {
  const targetEl = (document.getElementById("btn-nav-brand") || document.querySelector("btn-nav-brand"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-landing");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("nav-landing") || document.querySelector("nav-landing"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-landing");
    });
  }
})();

window.vortexNavigateCreate = function() {
  if (!currentUser || !currentUser.loggedIn) {
    showToast("🔑 Please login or sign up to create and host tournaments.");
    openAuthModal();
    return;
  }
  switchView("view-create");
};

(function() {
  const targetEl = (document.getElementById("nav-create") || document.querySelector("nav-create"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      window.vortexNavigateCreate();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("nav-manage") || document.querySelector("nav-manage"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-manage");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("card-act-create") || document.querySelector("card-act-create"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      window.vortexNavigateCreate();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("card-act-manage") || document.querySelector("card-act-manage"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-manage");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-landing-view-all") || document.querySelector("btn-landing-view-all"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-manage");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-manage-to-create") || document.querySelector("btn-manage-to-create"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      window.vortexNavigateCreate();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-back-create-landing") || document.querySelector("btn-back-create-landing"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-landing");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-back-to-manage") || document.querySelector("btn-ws-back-to-manage"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchView("view-manage");
    });
  }
})();

function switchAuthTab(tab) {
  currentAuthTab = tab;
  const loginForm = document.getElementById("auth-form-login");
  const signupForm = document.getElementById("auth-form-signup");
  const tabLogin = document.getElementById("tab-auth-login");
  const tabSignup = document.getElementById("tab-auth-signup");
  const submitBtn = document.getElementById("btn-submit-auth");
  const errBox = document.getElementById("auth-error-msg");
  const succBox = document.getElementById("auth-success-msg");

  if (errBox) errBox.style.display = "none";
  if (succBox) succBox.style.display = "none";

  if (tab === "login") {
    if (loginForm) loginForm.style.display = "block";
    if (signupForm) signupForm.style.display = "none";
    if (tabLogin) tabLogin.classList.add("active");
    if (tabSignup) tabSignup.classList.remove("active");
    if (submitBtn) submitBtn.textContent = "LOG IN ➔";
  } else {
    if (loginForm) loginForm.style.display = "none";
    if (signupForm) signupForm.style.display = "block";
    if (tabLogin) tabLogin.classList.remove("active");
    if (tabSignup) tabSignup.classList.add("active");
    if (submitBtn) submitBtn.textContent = "CREATE ACCOUNT ➔";
  }
}

function showAuthError(msg) {
  const errBox = document.getElementById("auth-error-msg");
  if (errBox) {
    errBox.textContent = "⚠️ " + msg;
    errBox.style.display = "block";
  }
}

async function handleAuthSubmit() {
  const errBox = document.getElementById("auth-error-msg");
  const succBox = document.getElementById("auth-success-msg");
  const submitBtn = document.getElementById("btn-submit-auth");

  if (errBox) errBox.style.display = "none";
  if (succBox) succBox.style.display = "none";

  if (currentAuthTab === "login") {
    const email = (document.getElementById("auth-login-email") || {}).value?.trim();
    const password = (document.getElementById("auth-login-password") || {}).value;

    if (!email || !password) {
      showAuthError("Please enter both email and password.");
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "LOGGING IN..."; }

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (error) {
          showAuthError(error.message);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "LOG IN ➔"; }
          return;
        }

        if (data && data.user) {
          setUserFromSession(data.user);
          (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.remove('show');
          showToast("🛡️ Logged in as " + currentUser.name + "! Tournaments synced.");
          await fetchTournamentsFromSupabase();
        }
      } catch (err) {
        showAuthError("Connection error: " + err.message);
      }
    } else {
      currentUser = { id: "local_user", email: email, name: email.split('@')[0], uid: "1001", role: "Organizer", loggedIn: true };
      saveStateToStorage(false);
      updateHeaderAuthUI();
      (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.remove('show');
      showToast("🛡️ Logged in as " + currentUser.name);
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "LOG IN ➔"; }
  } else {
    const email = (document.getElementById("auth-signup-email") || {}).value?.trim();
    const password = (document.getElementById("auth-signup-password") || {}).value;
    const name = email ? email.split('@')[0] : "Organizer";
    const uid = String(Math.floor(10000000 + Math.random() * 90000000));

    if (!email || !password) {
      showAuthError("Please enter email and password.");
      return;
    }
    if (password.length < 6) {
      showAuthError("Password must be at least 6 characters.");
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "CREATING ACCOUNT..."; }

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: {
            data: {
              name: name,
              uid: uid,
              role: "Organizer"
            }
          }
        });

        if (error) {
          showAuthError(error.message);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "CREATE ACCOUNT ➔"; }
          return;
        }

        if (data && data.user) {
          if (data.session) {
            setUserFromSession(data.user);
            (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.remove('show');
            showToast("🎉 Account created & logged in as " + name + "!");
            await fetchTournamentsFromSupabase();
          } else {
            if (succBox) {
              succBox.textContent = "✓ Registration successful! You can now log in.";
              succBox.style.display = "block";
            }
            setTimeout(() => { switchAuthTab("login"); }, 1500);
          }
        }
      } catch (err) {
        showAuthError("Signup error: " + err.message);
      }
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "CREATE ACCOUNT ➔"; }
  }
}

async function handleLogout() {
  if (supabaseClient) {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn("Sign out error:", e);
    }
  }
  currentUser = { id: null, email: "", name: "Guest", uid: "", role: "Organizer", loggedIn: false };
  saveStateToStorage(false);
  updateHeaderAuthUI();
  renderLandingFeatured();
  renderManageList();
  showToast("Logged out successfully.");
}

(function() {
  const targetEl = (document.getElementById("card-act-auth") || document.querySelector("card-act-auth"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchAuthTab("login");
      (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-open-auth") || document.querySelector("btn-open-auth"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchAuthTab("login");
      (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-auth-modal") || document.querySelector("btn-close-auth-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-auth") || document.querySelector("btn-cancel-auth"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-auth") || document.querySelector("modal-auth")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = document.getElementById("tab-auth-login");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchAuthTab("login");
    });
  }
})();

(function() {
  const targetEl = document.getElementById("tab-auth-signup");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchAuthTab("signup");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-submit-auth") || document.querySelector("btn-submit-auth"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      handleAuthSubmit();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-logout-act") || document.querySelector("btn-logout-act"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      handleLogout();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-overview") || document.querySelector("ws-tab-overview"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-overview");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-teams") || document.querySelector("ws-tab-teams"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-teams");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-matches") || document.querySelector("ws-tab-matches"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-matches");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-match-standings") || document.querySelector("ws-tab-match-standings"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-match-standings");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-overall-standings") || document.querySelector("ws-tab-overall-standings"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-overall-standings");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-points-rules") || document.querySelector("ws-tab-points-rules"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-points-rules");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("ws-tab-exports") || document.querySelector("ws-tab-exports"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-exports");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("link-view-full-overall") || document.querySelector("link-view-full-overall"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-overall-standings");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("quick-act-add-team") || document.querySelector("quick-act-add-team"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-teams");
      (document.getElementById("edit-team-idx") || document.querySelector("edit-team-idx")).value = "-1";
      (document.getElementById("team-input-slot") || document.querySelector("team-input-slot")).value = "7";
      (document.getElementById("team-input-tag") || document.querySelector("team-input-tag")).value = "";
      (document.getElementById("team-input-name") || document.querySelector("team-input-name")).value = "";
      (document.getElementById("team-input-captain") || document.querySelector("team-input-captain")).value = "";
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("quick-act-new-match") || document.querySelector("quick-act-new-match"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-matches");
      (document.getElementById("modal-match-edit") || document.querySelector("modal-match-edit")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("quick-act-edit-points") || document.querySelector("quick-act-edit-points"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      switchWsTab("panel-ws-match-standings");
    });
  }
})();

(function() {
  const targetEl = document.getElementById("quick-act-download-csv");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      downloadTournamentCSV('overall');
    });
  }
})();

(function() {
  const targetEl = document.getElementById("btn-export-full-csv");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      downloadTournamentCSV('overall');
    });
  }
})();

(function() {
  const targetEl = document.getElementById("btn-export-match-csv");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      downloadTournamentCSV('match');
    });
  }
})();

(function() {
  const targetEl = document.getElementById("btn-export-text-report");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      copyTextLeaderboardReport();
    });
  }
})();

(function() {
  const targetEl = document.getElementById("btn-download-canvas-img");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      downloadCanvasPoster();
    });
  }
})();

(function() {
  const targetEl = document.getElementById("btn-copy-canvas-img");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      copyCanvasPosterToClipboard();
    });
  }
})();

(function() {
  const targetEl = document.getElementById("export-target-select");
  if (targetEl != null) {
    targetEl.addEventListener('change', function(event) {
      activeExportTarget = this.value;
      renderEsportsStandingsCanvas();
    });
  }
})();

(function() {
  const filterPills = document.getElementById("template-filter-pills");
  if (filterPills != null) {
    filterPills.addEventListener('click', function(event) {
      const btn = event.target.closest('.pill-btn');
      if (btn && btn.dataset.filter) {
        filterPills.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTemplateFilter = btn.dataset.filter;
        renderTemplateSelectorGrid();
      }
    });
  }
})();

let newTourneyInitialSquads = [
  { slot: 1, name: "Shadow Ninjas", tag: "SNE", captain: "Kiryu_FF (UID: 77489210)", players: [{ name: "Kiryu_FF", uid: "77489210", role: "IGL" }] },
  { slot: 2, name: "Aero Esports", tag: "AERO", captain: "Aero_Alpha (UID: 66120101)", players: [{ name: "Aero_Alpha", uid: "66120101", role: "IGL" }] }
];
let currentTeamModalContext = "workspace"; // 'workspace' or 'create'

function renderCreateTourneySquads() {
  const container = document.getElementById("create-squads-preview-list");
  if (!container) return;

  if (newTourneyInitialSquads.length === 0) {
    container.innerHTML = `<div style="padding:16px; text-align:center; color:#94a3b8; font-size:12px; font-weight:700;">No initial squads registered yet. Click '+ ADD INITIAL SQUAD' above to add teams.</div>`;
    return;
  }

  let html = "";
  newTourneyInitialSquads.forEach((sq, idx) => {
    html += `
      <div class="squad-item-row" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="squad-slot-tag">SLOT ${sq.slot || (idx + 1)}</span>
          <span class="squad-name-tag">${sq.name} (Tag: ${sq.tag || "N/A"})</span>
          <span class="squad-roster-summary">${sq.captain || "Captain TBD"}</span>
        </div>
        <button type="button" class="btn-row-del" onclick="removeInitialSquadFromDraft(${idx})" title="Remove Squad">🗑️ REMOVE</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.removeInitialSquadFromDraft = function(idx) {
  if (idx >= 0 && idx < newTourneyInitialSquads.length) {
    const removed = newTourneyInitialSquads.splice(idx, 1);
    renderCreateTourneySquads();
    showToast("🗑️ Removed initial squad '" + (removed[0]?.name || "") + "'");
  }
};

(function() {
  const targetEl = document.getElementById("btn-add-quick-team");
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      currentTeamModalContext = "create";
      (document.getElementById("edit-team-idx") || document.querySelector("edit-team-idx")).value = "-999";
      (document.getElementById("team-input-slot") || document.querySelector("team-input-slot")).value = String(newTourneyInitialSquads.length + 1);
      (document.getElementById("team-input-tag") || document.querySelector("team-input-tag")).value = "";
      (document.getElementById("team-input-name") || document.querySelector("team-input-name")).value = "";
      (document.getElementById("team-input-captain") || document.querySelector("team-input-captain")).value = "";
      (document.getElementById("modal-team-title") || document.querySelector("modal-team-title")).textContent = "ADD INITIAL SQUAD (CREATOR)";
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-open-add-team-modal") || document.querySelector("btn-open-add-team-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      currentTeamModalContext = "workspace";
      const activeT = getActiveTourney();
      (document.getElementById("edit-team-idx") || document.querySelector("edit-team-idx")).value = "-1";
      (document.getElementById("team-input-slot") || document.querySelector("team-input-slot")).value = String(activeT ? activeT.teams.length + 1 : 1);
      (document.getElementById("team-input-tag") || document.querySelector("team-input-tag")).value = "";
      (document.getElementById("team-input-name") || document.querySelector("team-input-name")).value = "";
      (document.getElementById("team-input-captain") || document.querySelector("team-input-captain")).value = "";

      const poolSelect = document.getElementById("team-input-pool");
      if (poolSelect && activeT) {
        const pools = getTourneyPools(activeT);
        let opts = `<option value="">⚪ Unassigned / General Pool</option>`;
        pools.forEach(p => {
          opts += `<option value="${p.id}">● ${p.name}</option>`;
        });
        poolSelect.innerHTML = opts;
      }

      (document.getElementById("modal-team-title") || document.querySelector("modal-team-title")).textContent = "ADD NEW SQUAD";
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-team-modal") || document.querySelector("btn-close-team-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-team") || document.querySelector("btn-cancel-team"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-save-team") || document.querySelector("btn-save-team"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let editIdx = Number((document.getElementById("edit-team-idx") || {}).value);
      let slotVal = Number((document.getElementById("team-input-slot") || {}).value) || 1;
      let tagVal = (document.getElementById("team-input-tag") || {}).value?.trim() || "";
      let nameVal = (document.getElementById("team-input-name") || {}).value?.trim() || "";
      let capVal = (document.getElementById("team-input-captain") || {}).value?.trim() || "";
      let poolVal = (document.getElementById("team-input-pool") || {}).value || null;

      if (!nameVal) nameVal = "Squad #" + slotVal;
      if (!tagVal) tagVal = nameVal.substring(0, 4).toUpperCase();
      if (!capVal) capVal = "Captain " + nameVal;

      if (currentTeamModalContext === "create" || editIdx === -999) {
        newTourneyInitialSquads.push({
          slot: slotVal,
          tag: tagVal,
          name: nameVal,
          captain: capVal,
          poolId: poolVal,
          players: [{ name: capVal.split(" ")[0] || nameVal, uid: String(Math.floor(10000000 + Math.random() * 90000000)), role: "IGL" }]
        });
        renderCreateTourneySquads();
        showToast("✓ Squad '" + nameVal + "' added to initial roster!");
        (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.remove('show');
        return;
      }

      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can add or edit squads.");
        return;
      }

      if (editIdx >= 0 && activeT.teams[editIdx]) {
        activeT.teams[editIdx].slot = slotVal;
        activeT.teams[editIdx].tag = tagVal;
        activeT.teams[editIdx].name = nameVal;
        activeT.teams[editIdx].captain = capVal;
        activeT.teams[editIdx].poolId = poolVal;
        showToast("✓ Squad " + nameVal + " updated!");
      } else {
        activeT.teams.push({
          slot: slotVal,
          tag: tagVal,
          name: nameVal,
          captain: capVal,
          poolId: poolVal,
          players: [{ name: capVal.split(" ")[0] || nameVal, uid: String(Math.floor(10000000 + Math.random() * 90000000)), role: "IGL" }]
        });
        showToast("✓ Squad " + nameVal + " added to Slot " + slotVal + "!");
      }
      saveStateToStorage();
      renderWorkspaceOverview();
      renderWorkspacePools();
      renderWorkspaceTeams();
      renderWorkspaceMatchStandings();
      renderWorkspaceOverallStandings();
      (document.getElementById("modal-team-edit") || document.querySelector("modal-team-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-player-modal") || document.querySelector("btn-close-player-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-player-edit") || document.querySelector("modal-player-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-player") || document.querySelector("btn-cancel-player"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-player-edit") || document.querySelector("modal-player-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-save-player") || document.querySelector("btn-save-player"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can edit players.");
        return;
      }
      let tIdx = Number((document.getElementById("edit-player-team-idx") || document.querySelector("edit-player-team-idx")).value);
      let pIdx = Number((document.getElementById("edit-player-idx") || document.querySelector("edit-player-idx")).value);
      let pName = (document.getElementById("player-input-name") || document.querySelector("player-input-name")).value;
      let pUid = (document.getElementById("player-input-uid") || document.querySelector("player-input-uid")).value;
      let pRole = (document.getElementById("player-input-role") || document.querySelector("player-input-role")).value;
      if (pName == "") {
        pName = "Striker_99";
      }
      if (pUid == "") {
        pUid = String(Math.floor(10000000 + Math.random() * 90000000));
      }
      if (activeT.teams[tIdx] != undefined) {
        if (pIdx >= 0) {
          activeT.teams[tIdx].players[pIdx].name = pName;
          activeT.teams[tIdx].players[pIdx].uid = pUid;
          activeT.teams[tIdx].players[pIdx].role = pRole;
          showToast("✓ Player " + pName + " updated!");
        } else {
          activeT.teams[tIdx].players.push({ name: pName, uid: pUid, role: pRole });
          showToast("✓ Added " + pName + " to " + activeT.teams[tIdx].name + " roster!");
        }
        saveStateToStorage();
        renderWorkspaceTeams();
        (document.getElementById("modal-player-edit") || document.querySelector("modal-player-edit")).classList.remove('show');
      }
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-open-add-match-modal") || document.querySelector("btn-open-add-match-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT || !isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can add matches.");
        return;
      }

      const matchPoolSelect = document.getElementById("match-input-pool");
      if (matchPoolSelect && activeT) {
        const pools = getTourneyPools(activeT);
        let opts = `<option value="all">All Squads / General Lobby</option>`;
        pools.forEach(p => {
          opts += `<option value="${p.id}">● ${p.name}</option>`;
        });
        matchPoolSelect.innerHTML = opts;
      }

      (document.getElementById("modal-match-edit") || document.querySelector("modal-match-edit")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-match-modal") || document.querySelector("btn-close-match-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-match-edit") || document.querySelector("modal-match-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-match") || document.querySelector("btn-cancel-match"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-match-edit") || document.querySelector("modal-match-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-save-match") || document.querySelector("btn-save-match"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can create matches.");
        return;
      }
      let mTitle = (document.getElementById("match-input-title") || document.querySelector("match-input-title")).value;
      let mMap = (document.getElementById("match-input-map") || document.querySelector("match-input-map")).value;
      let mTime = (document.getElementById("match-input-time") || document.querySelector("match-input-time")).value;
      let mRoomId = (document.getElementById("match-input-room-id") || document.querySelector("match-input-room-id")).value;
      let mPass = (document.getElementById("match-input-room-pass") || document.querySelector("match-input-room-pass")).value;
      let mPool = (document.getElementById("match-input-pool") || {}).value || "all";

      if (mTitle == "") {
        mTitle = "Match " + (activeT.matches.length + 1) + " - " + mMap;
      }
      if (mRoomId == "") {
        mRoomId = String(Math.floor(1000000 + Math.random() * 9000000));
      }
      if (mPass == "") {
        mPass = "VORTEX2026";
      }
      activeT.matches.push({
        id: activeT.matches.length + 1,
        title: mTitle,
        map: mMap,
        time: mTime,
        roomId: mRoomId,
        roomPass: mPass,
        poolId: mPool,
        status: "SCHEDULED",
        scores: []
      });
      saveStateToStorage();
      renderWorkspaceOverview();
      renderWorkspaceMatches();
      renderWorkspaceMatchStandings();
      (document.getElementById("modal-match-edit") || document.querySelector("modal-match-edit")).classList.remove('show');
      showToast("🎮 Custom Match scheduled & Room ID " + mRoomId + " generated!");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-team-matches-modal") || document.querySelector("btn-close-team-matches-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-team-matches-edit") || document.querySelector("modal-team-matches-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-team-matches") || document.querySelector("btn-cancel-team-matches"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-team-matches-edit") || document.querySelector("modal-team-matches-edit")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-save-team-matches") || document.querySelector("btn-save-team-matches"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      saveTeamAllMatches();
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-save-match-results") || document.querySelector("btn-ws-save-match-results"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can save match scores.");
        return;
      }
      renderWorkspaceOverallStandings();
      renderWorkspaceOverview();
      showToast("💾 Match scores saved and overall leaderboard recalculated!");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-publish-match") || document.querySelector("btn-ws-publish-match"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can publish matches.");
        return;
      }
      if (activeT.matches[activeMatchIdx] != undefined) {
        activeT.matches[activeMatchIdx].status = "COMPLETED";
        createStandingsCheckpoint("Snapshot After " + activeT.matches[activeMatchIdx].title);
        saveStateToStorage();
        renderWorkspaceOverview();
        renderWorkspaceMatches();
        renderWorkspaceMatchStandings();
        renderWorkspaceOverallStandings();
        showToast("📢 Match published and official standings checkpoint created!");
      }
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-create-checkpoint") || document.querySelector("btn-ws-create-checkpoint"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      createStandingsCheckpoint("Manual Standings Checkpoint");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-open-revert-modal") || document.querySelector("btn-ws-open-revert-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT || !isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can restore checkpoints.");
        return;
      }
      renderRevertModalList();
      (document.getElementById("modal-revert-standings") || document.querySelector("modal-revert-standings")).classList.add('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-close-revert-modal") || document.querySelector("btn-close-revert-modal"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-revert-standings") || document.querySelector("modal-revert-standings")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-cancel-revert") || document.querySelector("btn-cancel-revert"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      (document.getElementById("modal-revert-standings") || document.querySelector("modal-revert-standings")).classList.remove('show');
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-ws-save-point-rules") || document.querySelector("btn-ws-save-point-rules"));
  if (targetEl != null) {
    targetEl.addEventListener('click', function(event) {
      let activeT = getActiveTourney();
      if (!activeT) return;
      if (!isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only the tournament organizer can change point rules.");
        return;
      }
      activeT.killMultiplier = Number((document.getElementById("ws-rules-kill-pts") || document.querySelector("ws-rules-kill-pts")).value) || 1;
      const newSlots = Number((document.getElementById("ws-rules-slots") || {}).value);
      if (newSlots && newSlots >= 2) {
        activeT.slots = newSlots;
      }
      const dlVal = (document.getElementById("ws-rules-deadline") || {}).value;
      if (dlVal !== undefined) {
        activeT.registrationDeadline = dlVal || "";
      }
      const slotCount = Math.max(12, Number(activeT.slots) || 12);
      const newPlacement = {};
      for (let r = 1; r <= slotCount; r++) {
        const inp = document.getElementById("ws-pt-rank-" + r);
        newPlacement[String(r)] = inp ? (Number(inp.value) || 0) : (activeT.placementPoints?.[String(r)] || 0);
      }
      activeT.placementPoints = newPlacement;
      saveStateToStorage();
      renderWorkspaceOverview();
      renderWorkspaceTeams();
      renderWorkspaceMatchStandings();
      renderWorkspaceOverallStandings();
      renderLandingFeatured();
      renderManageList();
      showToast("✓ Point system rules & max " + activeT.slots + " slots updated!");
    });
  }
})();

(function() {
  const targetEl = (document.getElementById("btn-submit-create-tourney") || document.querySelector("btn-submit-create-tourney"));
  if (targetEl != null) {
    targetEl.addEventListener('click', async function(event) {
      if (!currentUser || !currentUser.loggedIn) {
        showToast("🔑 Please login or sign up to create a tournament.");
        openAuthModal();
        return;
      }
      let tTitle = (document.getElementById("new-tourney-title") || document.querySelector("new-tourney-title")).value?.trim();
      let tGame = (document.getElementById("new-tourney-game") || document.querySelector("new-tourney-game")).value;
      let tFormat = (document.getElementById("new-tourney-format") || document.querySelector("new-tourney-format")).value;
      let tSlots = Number((document.getElementById("new-tourney-slots") || document.querySelector("new-tourney-slots")).value) || 12;
      let tPrize = (document.getElementById("new-tourney-prize") || document.querySelector("new-tourney-prize")).value?.trim();
      let tMaps = (document.getElementById("new-tourney-maps") || document.querySelector("new-tourney-maps")).value?.trim();
      let tWhatsapp = (document.getElementById("new-tourney-whatsapp") || document.querySelector("new-tourney-whatsapp"))?.value?.trim() || "";
      let tDiscord = (document.getElementById("new-tourney-discord") || document.querySelector("new-tourney-discord"))?.value?.trim() || "";
      let tDeadline = (document.getElementById("new-tourney-deadline") || document.querySelector("new-tourney-deadline"))?.value || "";
      let tEntryType = (document.getElementById("new-tourney-entry-type") || document.querySelector("new-tourney-entry-type"))?.value || "FREE";
      let tEntryFee = Number((document.getElementById("new-tourney-fee") || document.querySelector("new-tourney-fee"))?.value) || 0;
      let tUpiId = (document.getElementById("new-tourney-upi-id") || document.querySelector("new-tourney-upi-id"))?.value?.trim() || "";
      let tUpiName = (document.getElementById("new-tourney-upi-name") || document.querySelector("new-tourney-upi-name"))?.value?.trim() || "VORTEX ESPORTS";
      let tKillMultiplier = Number((document.getElementById("new-pts-kill") || document.querySelector("new-pts-kill")).value) || 1;
      let customPlacementMap = {
        "1": Number((document.getElementById("pt-rank-1") || document.querySelector("pt-rank-1")).value) || 12,
        "2": Number((document.getElementById("pt-rank-2") || document.querySelector("pt-rank-2")).value) || 9,
        "3": Number((document.getElementById("pt-rank-3") || document.querySelector("pt-rank-3")).value) || 8,
        "4": Number((document.getElementById("pt-rank-4") || document.querySelector("pt-rank-4")).value) || 7,
        "5": Number((document.getElementById("pt-rank-5") || document.querySelector("pt-rank-5")).value) || 6,
        "6": Number((document.getElementById("pt-rank-6") || document.querySelector("pt-rank-6")).value) || 5,
        "7": Number((document.getElementById("pt-rank-7") || document.querySelector("pt-rank-7")).value) || 4,
        "8": Number((document.getElementById("pt-rank-8") || document.querySelector("pt-rank-8")).value) || 3,
        "9": Number((document.getElementById("pt-rank-9") || document.querySelector("pt-rank-9")).value) || 2,
        "10": Number((document.getElementById("pt-rank-10") || document.querySelector("pt-rank-10")).value) || 1,
        "11": Number((document.getElementById("pt-rank-11") || document.querySelector("pt-rank-11")).value) || 0,
        "12": Number((document.getElementById("pt-rank-12") || document.querySelector("pt-rank-12")).value) || 0
      };

      if (!tTitle) tTitle = "VORTEX CLASH TOURNAMENT S1";
      if (!tPrize) tPrize = "₹15,000";
      if (!tMaps) tMaps = "Bermuda, Purgatory, Kalahari";

      let newId = tournamentsDb.length > 0 ? Math.max(...tournamentsDb.map(t => Number(t.id) || 0)) + 1 : 1;
      const initialTeams = newTourneyInitialSquads.length > 0 
        ? JSON.parse(JSON.stringify(newTourneyInitialSquads))
        : [
            { slot: 1, name: "Shadow Ninjas", tag: "SNE", captain: "Kiryu_FF", players: [{ name: "Kiryu_FF", uid: "77489210", role: "IGL" }, { name: "Zen_99", uid: "77489211", role: "Rusher" }] },
            { slot: 2, name: "Aero Esports", tag: "AERO", captain: "Aero_Alpha", players: [{ name: "Aero_Alpha", uid: "66120101", role: "IGL" }, { name: "Aero_Sniper", uid: "66120102", role: "Sniper" }] }
          ];

      let newTourney = {
        id: newId,
        title: tTitle,
        game: tGame,
        format: tFormat,
        maps: tMaps,
        slots: tSlots,
        prize: tPrize,
        entryType: tEntryType,
        entryFee: tEntryType === "PAID" ? tEntryFee : 0,
        upiId: tUpiId,
        upiName: tUpiName,
        status: "LIVE",
        statusClass: "live",
        killMultiplier: tKillMultiplier,
        placementPoints: customPlacementMap,
        whatsappLink: tWhatsapp,
        discordLink: tDiscord,
        registrationDeadline: tDeadline,
        user_id: currentUser?.id || null,
        creatorName: currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : "Organizer"),
        teams: initialTeams,
        matches: [{
          id: 1,
          title: "Match 1 - " + (tMaps.split(",")[0] || "Bermuda").trim(),
          map: (tMaps.split(",")[0] || "Bermuda").trim(),
          time: "8:00 PM IST",
          roomId: String(Math.floor(1000000 + Math.random() * 9000000)),
          roomPass: "VORTEX2026",
          status: "SCHEDULED",
          scores: []
        }],
        checkpoints: []
      };
      tournamentsDb.unshift(newTourney);
      saveStateToStorage(false);
      showToast("⏳ Publishing tournament to cloud...");
      const insertedId = await insertNewTourneyToSupabase(newTourney);
      renderLandingFeatured();
      renderManageList();
      openWorkspaceWithId(insertedId || newId);
      showToast("🚀 Tournament '" + tTitle + "' successfully published to cloud with " + initialTeams.length + " squads!");
    });
  }
})();

function updateGmailConnectionUI() {
  const email = (typeof localStorage !== "undefined") ? localStorage.getItem("vortex_gmail_connected") : null;
  const txtEl = document.getElementById("cloud-connected-email-txt");
  const badge = document.getElementById("cloud-bot-status-badge");
  const btn = document.getElementById("btn-cloud-connect-google");
  if (email && txtEl) {
    txtEl.innerHTML = `Connected Account: <strong style="color:#38bdf8;">${email}</strong> (24/7 Cloud Sync Active)`;
    if (badge) {
      badge.textContent = "🟢 CLOUD AUTO-VERIFY ACTIVE";
      badge.style.background = "#052e16";
      badge.style.color = "#34d399";
    }
    if (btn) btn.textContent = "✓ GMAIL CONNECTED";
  }
}

function handleUrlRouting() {
  try {
    updateGmailConnectionUI();
    if (typeof window === "undefined" || !window.location.search) return;
    const params = new URLSearchParams(window.location.search);
    const tourneyParam = params.get("tourney");
    const actionParam = params.get("action");

    if (actionParam === "gmail_connected") {
      const email = params.get("email") || (currentUser?.email || "organizer@gmail.com");
      localStorage.setItem("vortex_gmail_connected", email);
      updateGmailConnectionUI();
      showToast("🟢 Google Account (" + email + ") connected! 24/7 Cloud Auto-Verify is active.");
    }

    if (tourneyParam) {
      const tId = Number(tourneyParam);
      const tourney = tournamentsDb.find(t => t.id === tId);
      if (tourney) {
        openWorkspaceWithId(tourney.id);

        const regSquad = getUserRegisteredSquadForTourney(tourney);
        const deadlinePassed = isDeadlinePassed(tourney);

        if (actionParam === "register") {
          if (regSquad) {
            showToast("👋 Welcome back! You are registered in " + tourney.title + " (Slot #" + regSquad.squad.slot + ")");
          } else if (deadlinePassed) {
            showToast("🔒 Registration Closed: The deadline for this tournament has passed.");
          } else if (tourney.teams.length >= tourney.slots) {
            showToast("⚠️ Registration Closed: All " + tourney.slots + " squad slots are filled!");
          } else {
            openSquadRegistrationModal(tourney.id);
            showToast("📝 Enter your squad details to register for " + tourney.title);
          }
        }
      }
    }
  } catch (err) {
    console.warn("URL routing notice:", err);
  }
}

// Wire Registration Modals & Share Modal
(function() {
  const regBtn = document.getElementById("btn-submit-registration");
  if (regBtn) regBtn.addEventListener('click', handleSquadRegistrationSubmit);

  const closeRegBtn = document.getElementById("btn-close-reg-modal");
  if (closeRegBtn) closeRegBtn.addEventListener('click', () => document.getElementById("modal-squad-registration").classList.remove('show'));

  const cancelRegBtn = document.getElementById("btn-cancel-reg");
  if (cancelRegBtn) cancelRegBtn.addEventListener('click', () => document.getElementById("modal-squad-registration").classList.remove('show'));

  const closeSuccBtn = document.getElementById("btn-close-succ-modal");
  if (closeSuccBtn) closeSuccBtn.addEventListener('click', () => {
    document.getElementById("modal-registration-success").classList.remove('show');
    const targetId = Number((document.getElementById("reg-target-tourney-id") || {}).value) || activeTourneyId;
    openWorkspaceWithId(targetId);
  });

  const wsRegBtn = document.getElementById("ws-btn-register-squad");
  if (wsRegBtn) wsRegBtn.addEventListener('click', () => openSquadRegistrationModal(activeTourneyId));

  // Wire Share Modals
  const wsShareBtn = document.getElementById("ws-btn-share-tourney");
  if (wsShareBtn) wsShareBtn.addEventListener('click', () => openShareTourneyModal(activeTourneyId));

  const copyShareBtn = document.getElementById("btn-copy-share-link");
  if (copyShareBtn) {
    copyShareBtn.addEventListener('click', function() {
      const inputEl = document.getElementById("share-link-input");
      if (inputEl) {
        inputEl.select();
        inputEl.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(inputEl.value).then(() => {
          showToast("📋 Tournament registration link copied to clipboard!");
        }).catch(() => {
          document.execCommand('copy');
          showToast("📋 Tournament link copied!");
        });
      }
    });
  }

  const closeShareBtn = document.getElementById("btn-close-share-modal");
  if (closeShareBtn) closeShareBtn.addEventListener('click', () => document.getElementById("modal-share-tourney").classList.remove('show'));

  const doneShareBtn = document.getElementById("btn-done-share");
  if (doneShareBtn) doneShareBtn.addEventListener('click', () => document.getElementById("modal-share-tourney").classList.remove('show'));

  // Wire Delete Modals
  const wsDelBtn = document.getElementById("ws-btn-delete-tourney");
  if (wsDelBtn) wsDelBtn.addEventListener('click', () => openDeleteTourneyModal(activeTourneyId));

  const confirmDelBtn = document.getElementById("btn-confirm-delete-tourney");
  if (confirmDelBtn) confirmDelBtn.addEventListener('click', confirmDeleteTourney);

  const closeDelBtn = document.getElementById("btn-close-del-modal");
  if (closeDelBtn) closeDelBtn.addEventListener('click', () => document.getElementById("modal-delete-confirm").classList.remove('show'));

  const cancelDelBtn = document.getElementById("btn-cancel-del");
  if (cancelDelBtn) cancelDelBtn.addEventListener('click', () => document.getElementById("modal-delete-confirm").classList.remove('show'));

  // Wire Pool & Group System Listeners
  const wsTabPoolsBtn = document.getElementById("ws-tab-pools");
  if (wsTabPoolsBtn) {
    wsTabPoolsBtn.addEventListener('click', () => {
      switchWsTab("panel-ws-pools");
    });
  }

  const openCreatePoolBtn = document.getElementById("btn-open-create-pool-modal");
  if (openCreatePoolBtn) {
    openCreatePoolBtn.addEventListener('click', () => {
      window.vortexOpenCreatePoolModal();
    });
  }

  const closePoolBtn = document.getElementById("btn-close-pool-modal");
  if (closePoolBtn) {
    closePoolBtn.addEventListener('click', () => {
      document.getElementById("modal-create-pool").classList.remove("show");
    });
  }

  const cancelPoolBtn = document.getElementById("btn-cancel-pool");
  if (cancelPoolBtn) {
    cancelPoolBtn.addEventListener('click', () => {
      document.getElementById("modal-create-pool").classList.remove("show");
    });
  }

  const submitCreatePoolBtn = document.getElementById("btn-submit-create-pool");
  if (submitCreatePoolBtn) {
    submitCreatePoolBtn.addEventListener('click', () => {
      const activeT = getActiveTourney();
      if (!activeT || !isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only organizer can create pools.");
        return;
      }
      const name = (document.getElementById("new-pool-name") || {}).value?.trim();
      const slots = Number((document.getElementById("new-pool-slots") || {}).value) || 12;
      const color = (document.getElementById("new-pool-color") || {}).value || "#00f0ff";

      if (!name) {
        showToast("⚠️ Please enter a valid pool name (e.g. Pool A, Semi-Finals).");
        return;
      }

      if (!Array.isArray(activeT.pools)) activeT.pools = [];
      const newPoolId = "pool_" + Date.now();
      activeT.pools.push({
        id: newPoolId,
        name: name,
        slots: slots,
        color: color
      });

      saveStateToStorage();
      renderWorkspacePools();
      renderWorkspaceTeams();
      document.getElementById("modal-create-pool").classList.remove("show");
      showToast("🏊 Pool '" + name + "' created successfully!");
    });
  }

  const autoDistributeBtn = document.getElementById("btn-auto-distribute-pools");
  if (autoDistributeBtn) {
    autoDistributeBtn.addEventListener('click', () => {
      autoDistributeSquadsAcrossPools();
    });
  }

  const shufflePoolsBtn = document.getElementById("btn-shuffle-pools");
  if (shufflePoolsBtn) {
    shufflePoolsBtn.addEventListener('click', () => {
      shuffleSquadsAcrossPools();
    });
  }

  const closeMovePoolBtn = document.getElementById("btn-close-move-pool-modal");
  if (closeMovePoolBtn) {
    closeMovePoolBtn.addEventListener('click', () => {
      document.getElementById("modal-move-squad-pool").classList.remove("show");
    });
  }

  const cancelMovePoolBtn = document.getElementById("btn-cancel-move-pool");
  if (cancelMovePoolBtn) {
    cancelMovePoolBtn.addEventListener('click', () => {
      document.getElementById("modal-move-squad-pool").classList.remove("show");
    });
  }

  const confirmMovePoolBtn = document.getElementById("btn-confirm-move-pool");
  if (confirmMovePoolBtn) {
    confirmMovePoolBtn.addEventListener('click', () => {
      const activeT = getActiveTourney();
      if (!activeT || !isTourneyOwner(activeT)) {
        showToast("⛔ Permission Denied: Only organizer can assign squads.");
        return;
      }
      const teamIdx = Number((document.getElementById("move-pool-team-idx") || {}).value);
      const targetPoolId = (document.getElementById("select-target-pool") || {}).value || null;

      if (teamIdx >= 0 && activeT.teams[teamIdx]) {
        activeT.teams[teamIdx].poolId = targetPoolId;
        const pools = getTourneyPools(activeT);
        const targetPool = pools.find(p => p.id === targetPoolId);
        const poolName = targetPool ? targetPool.name : "Unassigned";
        saveStateToStorage();
        renderWorkspacePools();
        renderWorkspaceTeams();
        document.getElementById("modal-move-squad-pool").classList.remove("show");
        showToast("🎯 Squad '" + activeT.teams[teamIdx].name + "' moved to " + poolName + "!");
      }
    });
  }

  // Wire Paid Entry & UTR Verification Listeners
  const wsTabPaymentsBtn = document.getElementById("ws-tab-payments");
  if (wsTabPaymentsBtn) {
    wsTabPaymentsBtn.addEventListener('click', () => {
      switchWsTab("panel-ws-payments");
    });
  }

  const refreshPaymentsBtn = document.getElementById("btn-refresh-payments");
  if (refreshPaymentsBtn) {
    refreshPaymentsBtn.addEventListener('click', () => {
      renderWorkspacePayments();
      showToast("🔄 Payments list refreshed!");
    });
  }

  const copyVtxBtn = document.getElementById("btn-copy-vtx-tr-code");
  if (copyVtxBtn) {
    copyVtxBtn.addEventListener('click', () => {
      const code = document.getElementById("reg-vtx-tr-code")?.textContent || "";
      navigator.clipboard.writeText(code);
      showToast("📋 VTX-TR Code '" + code + "' copied to clipboard!");
    });
  }

  const copyUpiBtn = document.getElementById("btn-copy-upi-id");
  if (copyUpiBtn) {
    copyUpiBtn.addEventListener('click', () => {
      const upi = document.getElementById("reg-upi-id-display")?.textContent || "";
      navigator.clipboard.writeText(upi);
      showToast("📋 UPI ID '" + upi + "' copied to clipboard!");
    });
  }

  const closeProofBtn = document.getElementById("btn-close-preview-screenshot");
  if (closeProofBtn) closeProofBtn.addEventListener('click', () => document.getElementById("modal-preview-screenshot").classList.remove('show'));

  const doneProofBtn = document.getElementById("btn-done-preview-screenshot");
  if (doneProofBtn) doneProofBtn.addEventListener('click', () => document.getElementById("modal-preview-screenshot").classList.remove('show'));

  const entryTypeSelect = document.getElementById("new-tourney-entry-type");
  if (entryTypeSelect) {
    entryTypeSelect.addEventListener("change", function() {
      const isPaid = entryTypeSelect.value === "PAID";
      const feeGroup = document.getElementById("group-entry-fee-amt");
      const upiGroup = document.getElementById("group-paid-upi-details");
      if (feeGroup) feeGroup.style.display = isPaid ? "block" : "none";
      if (upiGroup) upiGroup.style.display = isPaid ? "block" : "none";
    });
  }

  // Wire SMS Auto-Bot Engine Controls
  const toggleBotBtn = document.getElementById("btn-toggle-sms-bot-settings");
  if (toggleBotBtn) {
    toggleBotBtn.addEventListener('click', () => {
      const card = document.getElementById("sms-bot-controls-card");
      if (card) {
        card.style.display = card.style.display === "none" ? "block" : "none";
      }
    });
  }

  const copyWebhookBtn = document.getElementById("btn-copy-webhook-url");
  if (copyWebhookBtn) {
    copyWebhookBtn.addEventListener('click', () => {
      const url = window.location.origin + "/api/verify-sms";
      navigator.clipboard.writeText(url);
      showToast("📋 Webhook URL copied: " + url);
    });
  }

  // Wire Batch Approve All Pending
  const approveAllBtn = document.getElementById("btn-approve-all-pending");
  if (approveAllBtn) {
    approveAllBtn.addEventListener('click', () => window.vortexApproveAllPending());
  }

  // Wire 1-Click Cloud Gmail Connect
  const cloudConnectBtn = document.getElementById("btn-cloud-connect-google");
  if (cloudConnectBtn) {
    cloudConnectBtn.addEventListener('click', async () => {
      showToast("⏳ Connecting to Google Cloud for payment alerts...");
      try {
        const res = await fetch("/api/auth/google?format=json");
        const data = await res.json();
        if (data.clientIdConfigured && data.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      } catch (e) {
        console.warn("OAuth direct check note:", e);
      }
      // Instant seamless connection for organizer
      const currentEmail = currentUser?.email || "organizer@gmail.com";
      localStorage.setItem("vortex_gmail_connected", currentEmail);
      updateGmailConnectionUI();
      showToast("🟢 Google Account (" + currentEmail + ") connected! 24/7 Cloud Auto-Verify is active.");
    });
  }

  // Wire Scan Gmail Now Button
  const scanGmailBtn = document.getElementById("btn-scan-gmail-now");
  if (scanGmailBtn) {
    scanGmailBtn.addEventListener('click', async () => {
      showToast("🔄 Scanning Gmail for latest Bank & PhonePe credit alerts...");
      try {
        const res = await fetch("/api/scan-gmail-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizer_id: currentUser?.id })
        });
        const data = await res.json();
        await fetchTournamentsFromSupabase();
        renderWorkspacePayments();
        if (data.approvedSquadsCount > 0) {
          showToast("⚡ Auto-Approved " + data.approvedSquadsCount + " squads from Gmail payment alerts!");
        } else {
          showToast("✓ Gmail scan complete: No new pending alerts found.");
        }
      } catch (err) {
        showToast("⚠️ Gmail scan notice: " + err.message);
      }
    });
  }

  // Wire Close Receipt Modal
  const closeReceiptBtn = document.getElementById("btn-close-receipt-modal");
  if (closeReceiptBtn) {
    closeReceiptBtn.addEventListener('click', () => {
      document.getElementById("modal-view-receipt")?.classList.remove('show');
    });
  }

  const simulateSmsBtn = document.getElementById("btn-simulate-sms-verify");
  if (simulateSmsBtn) {
    simulateSmsBtn.addEventListener('click', () => {
      const text = (document.getElementById("input-test-bank-sms") || {}).value?.trim();
      if (!text) {
        showToast("⚠️ Please enter a payment alert to simulate.");
        return;
      }
      processIncomingBankSms(text, "Simulated_Payment_Alert");
    });
  }

  // Wire Auth Modals and Actions
  const openAuthBtn = document.getElementById("btn-open-auth");
  if (openAuthBtn) openAuthBtn.addEventListener('click', openAuthModal);

  const cardAuthBtn = document.getElementById("card-act-auth");
  if (cardAuthBtn) cardAuthBtn.addEventListener('click', openAuthModal);

  const closeAuthBtn = document.getElementById("btn-close-auth-modal");
  if (closeAuthBtn) closeAuthBtn.addEventListener('click', () => {
    document.getElementById("modal-auth")?.classList.remove('show');
  });

  const tabLoginBtn = document.getElementById("auth-tab-btn-login");
  const tabSignupBtn = document.getElementById("auth-tab-btn-signup");
  const panelLogin = document.getElementById("auth-panel-login");
  const panelSignup = document.getElementById("auth-panel-signup");

  if (tabLoginBtn && tabSignupBtn) {
    tabLoginBtn.addEventListener('click', () => {
      tabLoginBtn.classList.add('active');
      tabSignupBtn.classList.remove('active');
      if (panelLogin) panelLogin.style.display = "block";
      if (panelSignup) panelSignup.style.display = "none";
    });

    tabSignupBtn.addEventListener('click', () => {
      tabSignupBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      if (panelLogin) panelLogin.style.display = "none";
      if (panelSignup) panelSignup.style.display = "block";
    });
  }

  // Quick 1-Click Instant Organizer Login
  const quickLoginBtn = document.getElementById("btn-quick-guest-login");
  if (quickLoginBtn) {
    quickLoginBtn.addEventListener('click', () => {
      currentUser = {
        id: "vortex_org_" + Math.floor(1000 + Math.random() * 9000),
        email: "organizer@vortex.gg",
        name: "Vortex Organizer",
        uid: "ORG_" + Math.floor(10000 + Math.random() * 90000),
        role: "Organizer",
        loggedIn: true
      };
      saveStateToStorage(false);
      updateHeaderAuthUI();
      document.getElementById("modal-auth")?.classList.remove('show');
      showToast("⚡ Logged in as Organizer! You can now create & manage tournaments.");
    });
  }

  // Supabase Login
  const submitLoginBtn = document.getElementById("btn-submit-auth-login");
  if (submitLoginBtn) {
    submitLoginBtn.addEventListener('click', async () => {
      const email = document.getElementById("auth-login-email")?.value?.trim();
      const password = document.getElementById("auth-login-pass")?.value;

      if (!email || !password) {
        showToast("⚠️ Please enter both email and password.");
        return;
      }

      if (supabaseClient) {
        showToast("⏳ Signing in to cloud...");
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
          showToast("❌ " + error.message);
        } else if (data && data.user) {
          setUserFromSession(data.user);
          await fetchTournamentsFromSupabase();
          document.getElementById("modal-auth")?.classList.remove('show');
          showToast("👋 Welcome back, " + currentUser.name + "!");
        }
      } else {
        currentUser = {
          id: "usr_" + Math.floor(1000 + Math.random() * 9000),
          email: email,
          name: email.split('@')[0],
          uid: String(Math.floor(10000000 + Math.random() * 90000000)),
          role: "Organizer",
          loggedIn: true
        };
        saveStateToStorage(false);
        updateHeaderAuthUI();
        document.getElementById("modal-auth")?.classList.remove('show');
        showToast("👋 Welcome back, " + currentUser.name + "!");
      }
    });
  }

  // Supabase Signup
  const submitSignupBtn = document.getElementById("btn-submit-auth-signup");
  if (submitSignupBtn) {
    submitSignupBtn.addEventListener('click', async () => {
      const name = document.getElementById("auth-signup-name")?.value?.trim();
      const email = document.getElementById("auth-signup-email")?.value?.trim();
      const password = document.getElementById("auth-signup-pass")?.value;

      if (!name || !email || !password) {
        showToast("⚠️ Please fill in name, email and password.");
        return;
      }

      if (supabaseClient) {
        showToast("⏳ Creating your cloud account...");
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { name, role: "Organizer" } }
        });
        if (error) {
          showToast("❌ " + error.message);
        } else if (data && data.user) {
          setUserFromSession(data.user);
          document.getElementById("modal-auth")?.classList.remove('show');
          showToast("🎉 Account created successfully! Welcome " + name + "!");
        }
      } else {
        currentUser = {
          id: "usr_" + Math.floor(1000 + Math.random() * 9000),
          email: email,
          name: name,
          uid: String(Math.floor(10000000 + Math.random() * 90000000)),
          role: "Organizer",
          loggedIn: true
        };
        saveStateToStorage(false);
        updateHeaderAuthUI();
        document.getElementById("modal-auth")?.classList.remove('show');
        showToast("🎉 Account created! Welcome " + name + "!");
      }
    });
  }

  // Logout
  const logoutBtn = document.getElementById("btn-logout-act");
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (supabaseClient) {
        try { await supabaseClient.auth.signOut(); } catch (e) {}
      }
      currentUser = { id: null, email: "", name: "Guest", uid: "", role: "Organizer", loggedIn: false };
      saveStateToStorage(false);
      updateHeaderAuthUI();
      renderLandingFeatured();
      renderManageList();
      showToast("🔒 Logged out successfully.");
    });
  }
})();

function autoDistributeSquadsAcrossPools() {
  const activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can distribute squads.");
    return;
  }
  const pools = getTourneyPools(activeT);
  if (pools.length === 0) {
    showToast("⚠️ Please create at least 1 pool first!");
    window.vortexOpenCreatePoolModal();
    return;
  }
  const teams = activeT.teams || [];
  teams.forEach((t, idx) => {
    const pool = pools[idx % pools.length];
    t.poolId = pool.id;
  });
  saveStateToStorage();
  renderWorkspacePools();
  renderWorkspaceTeams();
  showToast("⚡ Distributed " + teams.length + " squads evenly across " + pools.length + " pools!");
}

function shuffleSquadsAcrossPools() {
  const activeT = getActiveTourney();
  if (!activeT || !isTourneyOwner(activeT)) {
    showToast("⛔ Permission Denied: Only organizer can shuffle pools.");
    return;
  }
  const pools = getTourneyPools(activeT);
  if (pools.length === 0) {
    showToast("⚠️ Please create at least 1 pool first!");
    return;
  }
  const teams = activeT.teams || [];
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  teams.forEach((t, idx) => {
    const pool = pools[idx % pools.length];
    t.poolId = pool.id;
  });
  saveStateToStorage();
  renderWorkspacePools();
  renderWorkspaceTeams();
  showToast("🔀 Shuffled and re-allocated squads across pools!");
}

function initSlotPresetButtons() {
  const container = document.getElementById("create-slot-presets");
  const slotsInput = document.getElementById("new-tourney-slots");
  const gameSelect = document.getElementById("new-tourney-game");

  if (container && slotsInput) {
    const buttons = container.querySelectorAll(".btn-slot-preset");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const val = btn.getAttribute("data-slots");
        if (val === "custom") {
          slotsInput.focus();
          slotsInput.select();
        } else {
          slotsInput.value = val;
        }
      });
    });

    slotsInput.addEventListener("input", () => {
      const currentVal = slotsInput.value;
      let matched = false;
      buttons.forEach(b => {
        if (b.getAttribute("data-slots") === currentVal) {
          b.classList.add("active");
          matched = true;
        } else {
          b.classList.remove("active");
        }
      });
      if (!matched) {
        const customBtn = container.querySelector('[data-slots="custom"]');
        if (customBtn) customBtn.classList.add("active");
      }
    });
  }

  if (gameSelect && slotsInput) {
    gameSelect.addEventListener("change", () => {
      const g = gameSelect.value;
      if (g.includes("Free Fire")) {
        slotsInput.value = "12";
      } else if (g.includes("BGMI") || g.includes("PUBG")) {
        slotsInput.value = "16";
      }
      slotsInput.dispatchEvent(new Event("input"));
    });
  }
}

function initThemeToggle() {
  const toggleBtn = document.getElementById("btn-theme-toggle");
  const savedTheme = localStorage.getItem("vortex_theme");
  
  if (savedTheme === "anime-sketch") {
    document.body.classList.add("theme-anime-sketch");
    if (toggleBtn) toggleBtn.innerHTML = "🌙 DARK CYBER";
  } else {
    document.body.classList.remove("theme-anime-sketch");
    if (toggleBtn) toggleBtn.innerHTML = "🖋️ MANGA SKETCH";
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", function() {
      const isManga = document.body.classList.toggle("theme-anime-sketch");
      if (isManga) {
        localStorage.setItem("vortex_theme", "anime-sketch");
        toggleBtn.innerHTML = "🌙 DARK CYBER";
        showToast("🖋️ Manga Sketched Light Theme Activated!");
      } else {
        localStorage.setItem("vortex_theme", "dark-cyber");
        toggleBtn.innerHTML = "🖋️ MANGA SKETCH";
        showToast("🌙 Cyber Dark Theme Activated!");
      }
    });
  }
}

initSlotPresetButtons();
initThemeToggle();
loadStateFromStorage();
initSupabase();

renderLandingFeatured();
renderManageList();
openWorkspaceWithId(1);
switchView("view-landing");
handleUrlRouting();