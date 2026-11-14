// 房间完整流程集成测试（直接 import 服务端模块）
import { RoomManager } from '../server/rooms.js';
import { register, depositLoot, setLoadout, consumeLoadout, getUserByName } from '../server/store.js';

register('房主A', '123');
register('队员B', '123');
depositLoot('房主A', [{ id: 'ak', qty: 1 }, { id: 'a762', qty: 24 }], 0);
depositLoot('队员B', [{ id: 'bandage', qty: 4 }], 0);
setLoadout('房主A', [{ id: 'ak', qty: 1 }, { id: 'a762', qty: 24 }]);
setLoadout('队员B', [{ id: 'bandage', qty: 2 }]);

const mgr = new RoomManager(consumeLoadout);
const msgsA = [], msgsB = [];
const mkWs = (buf) => ({ readyState: 1, send: (d) => buf.push(JSON.parse(d)) });
const { room } = mgr.create('测试房', null, '房主A');
const rA = room.joinMember(mkWs(msgsA), { name: '房主A', stash: [], loadout: [], cash: 0, stats: {} });
const rB = room.joinMember(mkWs(msgsB), { name: '队员B', stash: [], loadout: [], cash: 0, stats: {} });

console.log('1. 未准备就开打:', JSON.stringify(room.start('房主A')));
room.toggleReady('房主A');
room.toggleReady('队员B');
console.log('2. 全员准备后开打:', JSON.stringify(room.start('房主A')));
console.log('   A背包:', rA.player.inv.map(e => e.id + '×' + e.qty).join(','));
console.log('   B背包:', rB.player.inv.map(e => e.id + '×' + e.qty).join(','));
console.log('   A仓库扣除后:', JSON.stringify(getUserByName('房主A').stash), '| 清单清空:', getUserByName('房主A').loadout.length === 0);
console.log('3. 对局中再加入:', JSON.stringify(room.joinMember(mkWs([]), { name: '路人C', stash: [], loadout: [], cash: 0, stats: {} }).err));

// B 阵亡
room.match.damage(rB.player, 999, false, null, '测试');
console.log('4. B阵亡后: 对局', room.match.state, '| B成员:', room.findMember('队员B').player === null ? '已出局回等待室' : '仍在对局');

// A 走到撤离点撤离（先落地）
rA.player.state = 'ground';
rA.player.x = 240; rA.player.z = 445; rA.player.y = 4;
rA.player.extractId = 'dock';          // 已在该撤离点搜刮站桩中
rA.player.extractProg = 0.999;
room.match.tick();
await new Promise(r => setTimeout(r, 300));
console.log('5. A撤离后: 对局', room.match.state, '| matchEnd广播:', msgsA.some(x => x.t === 'matchEnd'),
  '| 战利品清空:', room.match.loot.size === 0, '| 机器人清空:', room.match.bots.length === 0);
const rs = msgsA.filter(x => x.t === 'roomState').pop();
console.log('6. 最终roomState:', JSON.stringify(rs.state), JSON.stringify(rs.members));
process.exit(0);
