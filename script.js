const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const timerEl = document.getElementById("timer");
const levelEl = document.getElementById("level");
const xpEl = document.getElementById("xp");
const hpEl = document.getElementById("hp");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const levelUpModal = document.getElementById("levelUpModal");
const upgradeOptionsEl = document.getElementById("upgradeOptions");
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");

const TOTAL_TIME = 300;
const keys = new Set();

const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 14,
  speed: 220,
  attackDamage: 1,
  attackRange: 220,
  attackCooldown: 0.45,
  projectileSpeed: 540,
};

const state = {
  running: false,
  pausedForLevelUp: false,
  gameTime: 0,
  spawnAccumulator: 0,
  attackAccumulator: 0,
  level: 1,
  xp: 0,
  xpToNext: 8,
  bossSpawned: new Set(),
};

const enemies = [];
const projectiles = [];
const xpOrbs = [];

const upgrades = [
  { name: "攻击力增强", desc: "攻击伤害 +1", apply: () => (player.attackDamage += 1) },
  {
    name: "攻速提升",
    desc: "攻击间隔 -12%",
    apply: () => (player.attackCooldown = Math.max(0.15, player.attackCooldown * 0.88)),
  },
  { name: "移动加速", desc: "移动速度 +35", apply: () => (player.speed += 35) },
  { name: "射程提升", desc: "攻击距离 +40", apply: () => (player.attackRange += 40) },
  { name: "弹速提升", desc: "子弹速度 +120", apply: () => (player.projectileSpeed += 120) },
];

let lastTs = performance.now();
let joystickVector = { x: 0, y: 0 };
let joystickActive = false;

const isMobile = window.matchMedia("(pointer: coarse)").matches;
if (isMobile) joystick.classList.remove("hidden");

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pickSpawnPosition() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(0, canvas.width), y: -20 };
  if (side === 1) return { x: canvas.width + 20, y: rand(0, canvas.height) };
  if (side === 2) return { x: rand(0, canvas.width), y: canvas.height + 20 };
  return { x: -20, y: rand(0, canvas.height) };
}

function spawnEnemy(isBoss = false) {
  const pos = pickSpawnPosition();
  const t = state.gameTime;
  const scale = 1 + t / TOTAL_TIME;
  const hp = isBoss ? Math.floor(22 * scale) : Math.floor(2 + t / 40);
  enemies.push({
    x: pos.x,
    y: pos.y,
    radius: isBoss ? 30 : 12,
    hp,
    maxHp: hp,
    speed: isBoss ? 75 : 55 + t * 0.28,
    xp: isBoss ? 10 : 2,
    boss: isBoss,
  });
}

function maybeSpawnBoss() {
  for (const point of [150, 270]) {
    if (state.gameTime >= point && !state.bossSpawned.has(point)) {
      spawnEnemy(true);
      state.bossSpawned.add(point);
    }
  }
}

function handleInput(dt) {
  let dx = 0;
  let dy = 0;
  if (keys.has("w")) dy -= 1;
  if (keys.has("s")) dy += 1;
  if (keys.has("a")) dx -= 1;
  if (keys.has("d")) dx += 1;
  dx += joystickVector.x;
  dy += joystickVector.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    player.x = clamp(player.x + (dx / len) * player.speed * dt, player.radius, canvas.width - player.radius);
    player.y = clamp(player.y + (dy / len) * player.speed * dt, player.radius, canvas.height - player.radius);
  }
}

function nearestEnemyInRange() {
  let best = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d <= player.attackRange && d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function autoAttack(dt) {
  state.attackAccumulator += dt;
  if (state.attackAccumulator < player.attackCooldown) return;
  const target = nearestEnemyInRange();
  if (!target) return;
  state.attackAccumulator = 0;
  const vx = target.x - player.x;
  const vy = target.y - player.y;
  const len = Math.hypot(vx, vy) || 1;
  projectiles.push({
    x: player.x,
    y: player.y,
    vx: (vx / len) * player.projectileSpeed,
    vy: (vy / len) * player.projectileSpeed,
    radius: 4,
    damage: player.attackDamage,
    life: 1.4,
  });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j -= 1) {
      const e = enemies[j];
      if (Math.hypot(p.x - e.x, p.y - e.y) <= p.radius + e.radius) {
        e.hp -= p.damage;
        hit = true;
        if (e.hp <= 0) {
          xpOrbs.push({ x: e.x, y: e.y, radius: 7, value: e.xp });
          enemies.splice(j, 1);
        }
        break;
      }
    }
    if (hit || p.life <= 0 || p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) {
      projectiles.splice(i, 1);
    }
  }
}

function die() {
  state.running = false;
  messageEl.textContent = "你阵亡了，游戏结束";
  messageEl.classList.remove("hidden");
  restartBtn.classList.remove("hidden");
}

function updateEnemies(dt) {
  for (const e of enemies) {
    const vx = player.x - e.x;
    const vy = player.y - e.y;
    const len = Math.hypot(vx, vy) || 1;
    e.x += (vx / len) * e.speed * dt;
    e.y += (vy / len) * e.speed * dt;
    if (Math.hypot(e.x - player.x, e.y - player.y) <= e.radius + player.radius) {
      die();
      return;
    }
  }
}

function openLevelUp() {
  state.pausedForLevelUp = true;
  levelUpModal.classList.remove("hidden");
  upgradeOptionsEl.innerHTML = "";
  const options = [...upgrades].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const upgrade of options) {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML = `<h3>${upgrade.name}</h3><p>${upgrade.desc}</p>`;
    btn.addEventListener("click", () => {
      upgrade.apply();
      state.pausedForLevelUp = false;
      levelUpModal.classList.add("hidden");
      refreshHud();
    });
    upgradeOptionsEl.appendChild(btn);
  }
}

function tryLevelUp() {
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level += 1;
    state.xpToNext = Math.floor(state.xpToNext * 1.28 + 3);
    openLevelUp();
  }
}

function updateXpOrbs(dt) {
  for (let i = xpOrbs.length - 1; i >= 0; i -= 1) {
    const orb = xpOrbs[i];
    const d = Math.hypot(player.x - orb.x, player.y - orb.y);
    if (d < 120) {
      const vx = player.x - orb.x;
      const vy = player.y - orb.y;
      const len = Math.hypot(vx, vy) || 1;
      const speed = 160 + (120 - Math.min(120, d)) * 2;
      orb.x += (vx / len) * speed * dt;
      orb.y += (vy / len) * speed * dt;
    }
    if (d <= player.radius + orb.radius + 2) {
      state.xp += orb.value;
      xpOrbs.splice(i, 1);
      tryLevelUp();
    }
  }
}

function win() {
  state.running = false;
  messageEl.textContent = "生存成功！你坚持了 5 分钟";
  messageEl.classList.remove("hidden");
  restartBtn.classList.remove("hidden");
}

function refreshHud() {
  const remain = Math.max(0, TOTAL_TIME - state.gameTime);
  timerEl.textContent = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(Math.floor(remain % 60)).padStart(2, "0")}`;
  levelEl.textContent = state.level;
  xpEl.textContent = `${state.xp} / ${state.xpToNext}`;
  hpEl.textContent = "1";
}

function initGame() {
  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  player.speed = 220;
  player.attackDamage = 1;
  player.attackRange = 220;
  player.attackCooldown = 0.45;
  player.projectileSpeed = 540;

  state.running = true;
  state.pausedForLevelUp = false;
  state.gameTime = 0;
  state.spawnAccumulator = 0;
  state.attackAccumulator = 0;
  state.level = 1;
  state.xp = 0;
  state.xpToNext = 8;
  state.bossSpawned.clear();

  enemies.length = 0;
  projectiles.length = 0;
  xpOrbs.length = 0;

  messageEl.classList.add("hidden");
  restartBtn.classList.add("hidden");
  levelUpModal.classList.add("hidden");
  resetJoystick();
  refreshHud();
}

function update(dt) {
  if (!state.running || state.pausedForLevelUp) return;
  state.gameTime += dt;
  if (state.gameTime >= TOTAL_TIME) return win();

  state.spawnAccumulator += dt;
  const spawnInterval = Math.max(0.23, 0.8 - state.gameTime * 0.0015);
  while (state.spawnAccumulator >= spawnInterval) {
    state.spawnAccumulator -= spawnInterval;
    spawnEnemy(false);
  }

  maybeSpawnBoss();
  handleInput(dt);
  autoAttack(dt);
  updateProjectiles(dt);
  updateEnemies(dt);
  updateXpOrbs(dt);
  refreshHud();
}

function drawEntity(x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  xpOrbs.forEach((orb) => drawEntity(orb.x, orb.y, orb.radius, "#53ffd0"));
  projectiles.forEach((p) => drawEntity(p.x, p.y, p.radius, "#ffe07e"));

  for (const e of enemies) {
    drawEntity(e.x, e.y, e.radius, e.boss ? "#ff4d6d" : "#ff8f7e");
    if (e.boss) {
      const w = 50;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 6);
      ctx.fillStyle = "#66ff85";
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 6);
    }
  }

  drawEntity(player.x, player.y, player.radius, "#7db4ff");
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.attackRange, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(125,180,255,0.12)";
  ctx.stroke();
}

function gameLoop(ts) {
  const dt = Math.min(0.033, (ts - lastTs) / 1000);
  lastTs = ts;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    keys.add(key);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function setJoystickPosition(clientX, clientY) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const max = rect.width * 0.35;
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  stick.style.left = `${rect.width / 2 - 20 + dx}px`;
  stick.style.top = `${rect.height / 2 - 20 + dy}px`;
  joystickVector = { x: dx / max, y: dy / max };
}

function resetJoystick() {
  stick.style.left = "40px";
  stick.style.top = "40px";
  joystickVector = { x: 0, y: 0 };
}

joystick.addEventListener("pointerdown", (e) => {
  joystickActive = true;
  joystick.setPointerCapture(e.pointerId);
  setJoystickPosition(e.clientX, e.clientY);
});
joystick.addEventListener("pointermove", (e) => joystickActive && setJoystickPosition(e.clientX, e.clientY));
joystick.addEventListener("pointerup", () => {
  joystickActive = false;
  resetJoystick();
});
joystick.addEventListener("pointercancel", () => {
  joystickActive = false;
  resetJoystick();
});

restartBtn.addEventListener("click", initGame);
messageEl.textContent = "点击“开始 / 重新开始”即可试玩";
messageEl.classList.remove("hidden");
restartBtn.classList.remove("hidden");
refreshHud();
requestAnimationFrame(gameLoop);
