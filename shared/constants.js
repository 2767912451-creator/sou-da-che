// ============================================================
// 搜打撤 - 共享游戏配置（服务端与前端共用）
// ============================================================

// ---------- 地图 ----------
export const MAP = {
  SIZE: 1200,          // 岛屿正方形边长（米），中心在 (0,0)
  WATER_LEVEL: 0,      // 海平面
  SEED: 20241114,      // 地形随机种子，两端一致
};

// ---------- 地标 POI（会被压平用于建造）----------
// tier: 战利品等级 1=普通 2=丰富 3=高风险高收益
export const POIS = [
  { key: 'fish',   name: '渔村',       x: 240,  z: 380,  r: 110, y: 4,  tier: 1 },
  { key: 'resort', name: '废弃度假村', x: -260, z: 260,  r: 120, y: 8,  tier: 2 },
  { key: 'base',   name: '军事基地',   x: -320, z: -300, r: 240, y: 12, tier: 3 },
  { key: 'port',   name: '港口仓库区', x: 380,  z: -140, r: 120, y: 2,  tier: 2 },
  { key: 'mine',   name: '矿工营地',   x: -420, z: 40,   r: 90,  y: 9,  tier: 1 },
  { key: 'airfield', name: '废弃机场', x: 60,   z: -180, r: 130, y: 5,  tier: 2 },
  { key: 'lighthouse', name: '灯塔',   x: 90,   z: 480,  r: 70,  y: 16, tier: 2 },
  { key: 'shack',  name: '山间小屋',   x: 420,  z: 300,  r: 60,  y: 10, tier: 1 },
  { key: 'town',   name: '滨海小镇',   x: -40,  z: 120,  r: 130, y: 6,  tier: 2 },
];

// ---------- 武器 ----------
export const WEAPONS = {
  knife: { id: 'knife', name: '战术军刀', type: 'melee', dmg: 40, rate: 1.6, range: 2.4, mag: 0, reload: 0, spread: 0, ammo: null, auto: false, value: 300,
    desc: '淬火钢刃，摸哨与应急两用。近战 2.4 米，一刀 40 点伤害。' },
  p92:   { id: 'p92',   name: 'P92 手枪',     type: 'gun', dmg: 18, rate: 3.5,  range: 70,  mag: 12, reload: 1.6, spread: 0.022, ammo: 'a9',   auto: false,  value: 500,  headMult: 1.8,
    desc: '岛上最常见的制式手枪，人手一把的保底家伙。威力和精度都中规中矩。' },
  smg:   { id: 'smg',   name: '蜂鸟冲锋枪',   type: 'gun', dmg: 13, rate: 10,   range: 50,  mag: 30, reload: 2.2, spread: 0.038, ammo: 'a9',   auto: true,  value: 1600, headMult: 1.6,
    desc: '射速高达 10 发/秒的近战扫射利器，30 发弹匣火力泼水，但远距离发散。' },
  ak:    { id: 'ak',    name: 'AK-7 步枪',    type: 'gun', dmg: 26, rate: 6.5,  range: 110, mag: 30, reload: 2.5, spread: 0.030, ammo: 'a762', auto: true,  value: 3200, headMult: 2.0,
    desc: '全岛最抢手的自动步枪，单发 26 伤害、爆头翻倍，中远距离全能。' },
  lr:    { id: 'lr',    name: 'LR-338 狙击枪', type: 'gun', dmg: 85, rate: 0.9, range: 320, mag: 5,  reload: 3.2, spread: 0.003, ammo: 'a338', auto: false, value: 5200, headMult: 2.5,
    desc: '栓动狙击枪，一枪 85 伤害，爆头倍率 2.5——戴三级头盔也扛不住正面爆头。全岛仅军事基地出产。' },
};

// ---------- 物品 ----------
// kind: ammo 弹药 / med 医疗 / food 食物（可食用） / armor 护甲 / helmet 头盔 / pack 背包 / loot 值钱货 / junk 生活物资
// tex: 可选，物品贴图文件名（放 public/assets/items/ 下），会贴在道具模型上
export const ITEMS = {
  a9:     { id: 'a9',     name: '9mm 手枪弹',   kind: 'ammo',  stack: 60, value: 8,   qtyPerPack: 24,
    desc: '手枪与冲锋枪通用弹药，纸盒装 24 发。搜刮时通常一次能捡到一两盒。' },
  a762:   { id: 'a762',   name: '7.62 步枪弹',  kind: 'ammo',  stack: 60, value: 12,  qtyPerPack: 24,
    desc: 'AK-7 专用的全威力弹，黄铜弹壳。弹药紧缺时比枪还金贵。' },
  a338:   { id: 'a338',   name: '.338 狙击弹',  kind: 'ammo',  stack: 20, value: 25,  qtyPerPack: 8,
    desc: 'LR-338 专用的大口径弹，8 发一盒。每一发都值得精打细算。' },
  bandage:{ id: 'bandage',name: '绷带',         kind: 'med',   stack: 6,  value: 120, heal: 25, cast: 3.0, color: '#e8c9a0',
    desc: '军用止血绷带，花 3 秒缠好可回复 25 点生命。跑毒时救命的消耗品。' },
  medkit: { id: 'medkit', name: '急救包',       kind: 'med',   stack: 2,  value: 900, heal: 100, cast: 6.0, color: '#e05555',
    desc: '战地急救包，6 秒使用时间，无论多重的伤都能一次性回满。撤离前必带。' },
  energy: { id: 'energy', name: '能量饮料',     kind: 'med',   stack: 4,  value: 300, heal: 15, cast: 1.5, buff: 45, color: '#55cc88',
    desc: '"跑得快"牌功能饮料，回复 15 点生命并获得 45 秒移动加速。' },
  armor1: { id: 'armor1', name: '一级防弹衣',   kind: 'armor', stack: 1,  value: 700,  absorb: 0.25, dur: 60,
    desc: '轻质纤维防弹背心，减免 25% 躯体伤害，耐久 60。' },
  armor2: { id: 'armor2', name: '二级防弹衣',   kind: 'armor', stack: 1,  value: 1800, absorb: 0.40, dur: 100,
    desc: '加装陶瓷插板的战术背心，减免 40% 躯体伤害，耐久 100。' },
  armor3: { id: 'armor3', name: '三级防弹衣',   kind: 'armor', stack: 1,  value: 4200, absorb: 0.55, dur: 150,
    desc: '重型复合装甲，减免 55% 躯体伤害，耐久 150。缺点是像背了一块门板。' },
  helm1:  { id: 'helm1',  name: '一级头盔',     kind: 'helmet', stack: 1, value: 400,  headReduce: 0.2,
    desc: '凯夫拉头盔，爆头伤害降低 20%。聊胜于无。' },
  helm2:  { id: 'helm2',  name: '二级头盔',     kind: 'helmet', stack: 1, value: 1100, headReduce: 0.4,
    desc: '战术头盔带护目镜，爆头伤害降低 40%。' },
  helm3:  { id: 'helm3',  name: '三级头盔',     kind: 'helmet', stack: 1, value: 2600, headReduce: 0.6,
    desc: '防弹面罩全覆盖头盔，爆头伤害降低 60%。狙击枪外几乎免疫爆头。' },
  pack1:  { id: 'pack1',  name: '小背包',       kind: 'pack',  stack: 1,  value: 500, slots: 4,
    desc: '民用登山包，额外增加 4 格背包空间。' },
  pack2:  { id: 'pack2',  name: '战术背包',     kind: 'pack',  stack: 1,  value: 1500, slots: 8,
    desc: '军用大容量背包，额外增加 8 格背包空间。搜刮党的第一目标。' },
  // —— 值钱货 ——
  gold:   { id: 'gold',   name: '金条',         kind: 'loot',  stack: 3,  value: 3200, color: '#ffcf4d',
    desc: '一公斤重的小金条，撤离后直接折现。全岛最诱人的硬通货。' },
  watch:  { id: 'watch',  name: '古董怀表',     kind: 'loot',  stack: 4,  value: 1500, color: '#d8e0ff',
    desc: '民国时期的鎏金怀表，据说指针还能走。收藏家开价不低。' },
  gpu:    { id: 'gpu',    name: '显卡',         kind: 'loot',  stack: 2,  value: 2200, color: '#7fd4ff',
    desc: '拆机公版显卡，岛外矿老板抢着收。度假村机房常客。' },
  relic:  { id: 'relic',  name: '神秘文物',     kind: 'loot',  stack: 1,  value: 4800, color: '#c0f',
    desc: '岛上出土的无名器物，材质不明，通体幽紫。黑市开价 4800——有人为它丧了命。' },
  // —— 生活物资（随处可见，卖钱或吃掉）——
  apple:  { id: 'apple',  name: '苹果',         kind: 'food',  stack: 5,  value: 40,  heal: 10, cast: 1.5, color: '#e05a4a',
    desc: '南坡果园的红苹果，1.5 秒啃一个，回复 10 点生命。聊胜于无的干粮。' },
  water:  { id: 'water',  name: '瓶装水',       kind: 'food',  stack: 5,  value: 35,  heal: 8, cast: 1.5, color: '#7fc4e8',
    desc: '岛上囤积的矿泉水，喝一口回复 8 点生命。烈日下的海岛，水比弹药还实在。' },
  canned: { id: 'canned', name: '午餐肉罐头',   kind: 'food',  stack: 4,  value: 110, heal: 25, cast: 3.0, color: '#c9a86a',
    desc: '军用储备午餐肉，开罐 3 秒回复 25 点生命。铁皮罐哪都能塞。' },
  cup:    { id: 'cup',    name: '搪瓷水杯',     kind: 'junk',  stack: 4,  value: 60,  color: '#8fb8c9',
    desc: '印着"劳动最光荣"的老搪瓷杯，磕掉几块瓷。岛上人家的生活印记。' },
  cigs:   { id: 'cigs',   name: '香烟',         kind: 'junk',  stack: 5,  value: 90,  color: '#d8d3c8',
    desc: '两条软包香烟。守桥的、看货的、蹲撤离点的，都愿意拿弹药跟你换。' },
  battery:{ id: 'battery',name: '干电池',       kind: 'junk',  stack: 6,  value: 70,  color: '#5a6672',
    desc: '一号干电池六节装。岛上停电是常事，收废品的按节收。' },
  blanket:{ id: 'blanket',name: '旧毛毯',       kind: 'junk',  stack: 2,  value: 180, color: '#a8705a',
    desc: '部队配发的旧毛毯，卷起来沉甸甸。收荒匠给价不小气。' },
  flashlight:{ id: 'flashlight', name: '老式手电筒', kind: 'junk', stack: 3, value: 150, color: '#e8c95a',
    desc: '铁壳两节手电，玻璃罩裂了道缝。还能亮，收古董的也收这个。' },
  radio:  { id: 'radio',  name: '旧收音机',     kind: 'junk',  stack: 2,  value: 260, color: '#7a6a58',
    desc: '电子管收音机，旋钮转起来滋滋响。据说能收到岛外的求救频道。' },
  toolbox:{ id: 'toolbox',name: '工具箱',       kind: 'junk',  stack: 1,  value: 380, color: '#c96a3a',
    desc: '整套五金工具，矿场工人的吃饭家伙。维修佬出高价。' },
  milkfrog:{ id: 'milkfrog', name: '奶蛙玩偶',  kind: 'junk',  stack: 3,  value: 10,  color: '#f2cf5a',
    desc: '网红"奶蛙"毛绒玩偶，圆滚滚的肚子。除了可爱一无是处，但总有人愿意花 10 块钱带走它。' },
  pillow: { id: 'pillow', name: '王兰花抱枕',   kind: 'junk',  stack: 1,  value: 1000, color: '#dce8f5', tex: 'wanglanhua.jpg',
    desc: '印着岛上传说中的少女"王兰花"的方块抱枕，做工意外地精致。黑市收藏家出价 1000，说这是"限定周边"。' },
};

// 弹药对应武器
export const AMMO_OF = { a9: ['p92', 'smg'], a762: ['ak'], a338: ['lr'] };

// ---------- 初始携带（免费，死亡掉落）----------
export const START_LOADOUT = () => [
  { id: 'p92', qty: 1, mag: 12 },
  { id: 'a9',  qty: 24 },
  { id: 'bandage', qty: 2 },
];

// ---------- 缩圈阶段 ----------
// wait=静止时间(s) shrink=收缩时间(s) r=收缩目标半径 dps=圈外每秒伤害
export const ZONE_PHASES = [
  { wait: 50, shrink: 55, r: 520, dps: 3 },
  { wait: 40, shrink: 50, r: 340, dps: 5 },
  { wait: 35, shrink: 45, r: 210, dps: 8 },
  { wait: 30, shrink: 35, r: 120, dps: 12 },
  { wait: 25, shrink: 30, r: 60,  dps: 18 },
  { wait: 20, shrink: 25, r: 15,  dps: 25 },
];
export const ZONE_START_R = 780;
export const STORM_GRACE = 35;        // 最后圈收缩完后全场清场倒计时
export const INTERMISSION = 25;       // 局间休整（战利品重置）

// ---------- 森林区（额外树木密度，成片森林地形） ----------
export const FOREST_ZONES = [
  { x: 520, z: -40, r: 170, density: 260 },
  { x: -80, z: 460, r: 150, density: 200 },
  { x: 460, z: 160, r: 140, density: 170 },
];

// ---------- 撤离点 ----------
// period/open/offset: 每隔 period 秒开启 open 秒，offset 决定相位
export const EXTRACTORS = [
  { id: 'dock',     name: '渔村码头',   x: 240,  z: 445,  r: 14, period: 90, open: 38, offset: 0 },
  { id: 'beach',    name: '灯塔海滩',   x: 90,   z: 425,  r: 14, period: 90, open: 38, offset: 25 },
  { id: 'runway',   name: '机场跑道',   x: 60,   z: -180, r: 14, period: 90, open: 38, offset: 50 },
  { id: 'heli',     name: '基地机坪',   x: -320, z: -300, r: 14, period: 90, open: 38, offset: 65 },
];
export const EXTRACT_STAND_TIME = 8;   // 站立多少秒撤离成功

// ---------- 搜刮机制 ----------
// 地面物资：秒捡；家具上的道具：搜刮；保险柜：撬锁后才能拿
export const SEARCH = {
  table:    { name: '木桌',   dur: 1.6 },
  cabinet:  { name: '柜子',   dur: 2.0 },
  shelf:    { name: '货架',   dur: 1.4 },
  safe:     { name: '保险柜', dur: 6.0 },
  SAFE_ITEM_MAX: 2,           // 每个保险柜最多藏 2 件
  SAFE_MIN_VALUE: 1000,       // ≥此价值的道具优先藏进保险柜
};

// ---------- 玩家参数 ----------
export const PLAYER = {
  HP: 100,
  WALK: 4.4,           // m/s
  SPRINT: 7.4,
  CROUCH: 2.2,
  JUMP_V: 5.2,
  GRAVITY: 14,
  EYE: 1.62,           // 站立眼高
  EYE_CROUCH: 0.95,
  RADIUS: 0.42,
  HEIGHT: 1.8,
  SLOTS: 10,           // 基础背包格
};

// ---------- AI 拾荒者 ----------
export const BOTS = {
  COUNT: 10,
  HP: 60,
  AGGRO_R: 38,         // 索敌半径
  FIRE_INTERVAL: [0.7, 1.6],
  DMG: [6, 13],        // 随距离衰减
  HIT_BASE: 0.42,      // 命中率基准
  WALK: 3.2,
  SPRINT: 5.6,
};

// ---------- 其他 ----------
export const SNAPSHOT_HZ = 12;
export const MAX_PLAYERS = 16;
export const PICKUP_R = 2.6;
export const MATCH_LEN = (() => {
  let t = 0;
  for (const p of ZONE_PHASES) t += p.wait + p.shrink;
  return t + STORM_GRACE;
})();
export const CYCLE = MATCH_LEN + INTERMISSION;
