import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { allowedEmoji, DEFAULT_EMOJI, emojiCatalog } from '../src/features/emoji/catalog.js';
import { ClefSelector, EmojiError } from '../src/features/emoji/clef.js';
import { EmojiEffects } from '../src/features/emoji/handlers.js';
import { Storage } from '../src/database/storage.js';
import type { AuthenticatedActor, MessageEmoji } from '../src/lib/types.js';

type Response = { ok: true; data: { emoji: string; attachment: MessageEmoji } } | { ok: false; error: { code: string; message: string } };
class FakeSocket {
  connected = true;
  data: { actor?: AuthenticatedActor } = {};
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  on(event: string, callback: (...args: unknown[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]); }
  trigger(event: string, payload: unknown): Promise<Response> {
    return new Promise(resolve => { for (const listener of this.listeners.get(event) ?? []) listener(payload, resolve); });
  }
  fire(event: string) { for (const listener of this.listeners.get(event) ?? []) listener(); }
}
function fixtures() {
  const storage = new Storage(':memory:');
  const users = ['Alice', 'Bob', 'Charlie'].map(name => storage.createUser({name, canonicalName:name.toLowerCase(), passwordHash:'synthetic-hash'}));
  const [alice, bob, charlie] = users;
  const room = storage.findOrCreatePrivateRoom(alice.userId, bob.userId);
  const message = storage.sendMessage({senderId:alice.userId, roomId:room.roomId, clientMessageId:'one', text:'สวัสดี I am happy!'}).message;
  const socket = new FakeSocket();
  socket.data.actor = {userId:alice.userId, name:alice.name};
  return {storage, alice, bob, charlie, room, message, socket};
}
function code(response: Response): string { assert.equal(response.ok,false); return response.ok ? '' : response.error.code; }
function chosenEmoji(response: Response): string {
  assert.equal(response.ok,true);
  if (!response.ok) throw Error('Expected an emoji acknowledgement.');
  assert.equal(response.data.attachment.emoji,response.data.emoji);
  return response.data.emoji;
}

test('the curated subset fits one Clef Choice and contains distinct default-form emoji', () => {
  assert.ok(emojiCatalog.length>=2 && emojiCatalog.length<=255);
  assert.equal(allowedEmoji.size,emojiCatalog.length);
  assert.equal(DEFAULT_EMOJI,'🍅');
  assert.ok(allowedEmoji.has(DEFAULT_EMOJI));
  assert.equal(new Set(emojiCatalog.map(entry=>entry.id)).size,emojiCatalog.length);
  assert.equal(new Set(emojiCatalog.map(entry=>entry.name)).size,emojiCatalog.length);
  for (const emoji of ['👍🏿','👩‍💻','👨‍💻','🤴','👸','🎅','🤶','🤰','🫃','👫','👩‍❤️‍💋‍👨']) assert.equal(allowedEmoji.has(emoji),false,emoji);
  for (const emoji of ['😊','😐','❤️','👍','🧑‍💻','🐘','🇹🇭','🍜','🎸','💻']) assert.ok(allowedEmoji.has(emoji),emoji);
  for (const entry of emojiCatalog) {
    const points=Array.from(entry.emoji,character=>character.codePointAt(0)!);
    assert.ok(!points.some(n=>(n>=0x1f3fb && n<=0x1f3ff) || [0x2640,0x2642,0x1f468,0x1f469].includes(n)),entry.emoji);
    assert.ok(entry.name.trim().length>0);
  }
});

test('AI authorization precedes provider calls and uses only the persisted selected text', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  const texts: string[]=[];
  const effects=new EmojiEffects(f.storage,{suggest:async text=>{texts.push(text);return '😊';}},{cooldownMs:0});
  effects.register(f.socket);
  const payload={roomId:f.room.roomId,messageId:f.message.messageId};
  delete f.socket.data.actor;
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',payload)),'NOT_AUTHENTICATED');
  f.socket.data.actor={userId:f.charlie.userId,name:f.charlie.name};
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',payload)),'NOT_MEMBER');
  f.socket.data.actor={userId:f.alice.userId,name:f.alice.name};
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',{...payload,text:'forged input'})),'INVALID_PAYLOAD');
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',{...payload,messageId:'missing'})),'MESSAGE_NOT_AVAILABLE');
  assert.equal(texts.length,0);
  assert.equal(chosenEmoji(await f.socket.trigger('message.emojiSuggest',payload)),'😊');
  assert.deepEqual(texts,[f.message.text]);
  assert.equal(f.storage.loadHistory({actorId:f.alice.userId,roomId:f.room.roomId}).messages.length,1);
});

test('group nonmembers and pre-join messages cannot become AI input', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  const group=f.storage.createGroup(f.alice.userId,'Study');
  const before=f.storage.sendMessage({senderId:f.alice.userId,roomId:group.roomId,clientMessageId:'before',text:'secret before join'}).message;
  let calls=0;
  const effects=new EmojiEffects(f.storage,{suggest:async()=>{calls++;return '😊';}},{cooldownMs:0});
  effects.register(f.socket);
  f.socket.data.actor={userId:f.bob.userId,name:f.bob.name};
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',{roomId:group.roomId,messageId:before.messageId})),'NOT_MEMBER');
  f.storage.joinGroup(f.bob.userId,group.roomId);
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',{roomId:group.roomId,messageId:before.messageId})),'MESSAGE_NOT_AVAILABLE');
  assert.equal(calls,0);
  const after=f.storage.sendMessage({senderId:f.alice.userId,roomId:group.roomId,clientMessageId:'after',text:'visible after join'}).message;
  assert.equal(chosenEmoji(await f.socket.trigger('message.emojiSuggest',{roomId:group.roomId,messageId:after.messageId})),'😊');
});

test('final validation rejects unsafe selector output and sanitizes unexpected errors', async t => {
  for(const returned of ['👍🏿','🦄','not an emoji']) {
    const f=fixtures();
    const effects=new EmojiEffects(f.storage,{suggest:async()=>returned}); effects.register(f.socket);
    assert.equal(code(await f.socket.trigger('message.emojiSuggest',{roomId:f.room.roomId,messageId:f.message.messageId})),'AI_INVALID_RESPONSE');
    f.storage.close();
  }
  const f=fixtures(); t.after(()=>f.storage.close());
  new EmojiEffects(f.storage,{suggest:async()=>{throw Error('synthetic private upstream details');}}).register(f.socket);
  const result=await f.socket.trigger('message.emojiSuggest',{roomId:f.room.roomId,messageId:f.message.messageId});
  assert.equal(code(result),'INTERNAL_ERROR');
  assert.equal(JSON.stringify(result).includes('private upstream'),false);
});

test('concurrent/cooldown requests are bounded, and account changes discard a pending AI result', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  let finish!: (emoji: string)=>void;
  let cancelled: AbortSignal | undefined;
  let now=100;
  const effects=new EmojiEffects(f.storage,{suggest:async(_,signal)=>{cancelled=signal;return new Promise(resolve=>{finish=resolve;});}}, {now:()=>now});
  effects.register(f.socket);
  const payload={roomId:f.room.roomId,messageId:f.message.messageId};
  const pending=f.socket.trigger('message.emojiSuggest',payload);
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',payload)),'AI_RATE_LIMITED');
  f.socket.fire('auth.logout');
  assert.equal(cancelled?.aborted,true);
  f.socket.data.actor={userId:f.bob.userId,name:f.bob.name};
  finish('😊');
  assert.equal(code(await pending),'NOT_AUTHENTICATED');
  assert.deepEqual(f.storage.loadHistory({actorId:f.alice.userId,roomId:f.room.roomId}).messages[0].emojis,[]);
  f.socket.data.actor={userId:f.alice.userId,name:f.alice.name};
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',payload)),'AI_RATE_LIMITED');
  now+=999;
  assert.equal(code(await f.socket.trigger('message.emojiSuggest',payload)),'AI_RATE_LIMITED');
  now+=1;
  const next=f.socket.trigger('message.emojiSuggest',payload);
  finish('😊');
  assert.equal(chosenEmoji(await next),'😊');
});

test('Clef sends the entire subset in one HTTP request with no metadata or automatic retries', async t => {
  let mode='success';
  let selectedId='e_1f60a';
  let calls=0;
  const payloads: Array<Record<string,unknown>>=[];
  const server=createServer(async(req,res)=>{
    calls++;
    assert.equal(req.headers.authorization,'Bearer synthetic-token');
    assert.equal(req.url,'/client/v4/accounts/'+'0'.repeat(32)+'/ai/run/@cf/cloudflare/clef');
    const chunks: Buffer[]=[];
    for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString()); payloads.push(body);
    if(mode==='http') {res.writeHead(429);res.end('private quota error');return;}
    if(mode==='redirect') {res.writeHead(302,{location:'/should-never-follow'});res.end();return;}
    if(mode==='timeout') return;
    if(mode==='invalid-json') {res.end('<html>private provider details</html>');return;}
    const criteria=body.questions.selection.criteria as Record<string,string>;
    assert.ok(Object.keys(criteria).length>=2 && Object.keys(criteria).length<=255);
    let selected=selectedId;
    if(mode==='unsafe') selected='e_1f44d_1f3ff';
    if(mode==='outside-subset') selected='e_1f984';
    if(mode.startsWith('unknown')) selected='unknown-choice';
    const probabilities=Object.fromEntries(Object.keys(criteria).map(id=>[id,id===selected?1:0]));
    if(['unsafe','outside-subset','unknown-id'].includes(mode)) probabilities[selected]=1;
    if(mode==='unknown-known-scores') probabilities[selectedId]=1;
    if(mode==='unknown-bad-sum') probabilities[selected]=0.5;
    if(mode==='incomplete') delete probabilities[selected];
    if(mode==='bad-sum') probabilities[selected]=0.5;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({success:true,result:{answers:{selection:{type:'choice',choice:selected,confidence:1,probabilities}},usage:{input_tokens:10}}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const endpoint=new URL(`http://127.0.0.1:${address.port}/client/v4/accounts/${'0'.repeat(32)}/ai/run/@cf/cloudflare/clef`);
  const client=new ClefSelector({accountId:'0'.repeat(32),token:'synthetic-token'},{endpoint,timeoutMs:1000});
  assert.equal(await client.suggest('Synthetic happy message สุขใจ'),'😊');
  assert.equal(calls,1,'one provider request per selection');
  for(const payload of payloads) {
    assert.deepEqual(Object.keys(payload).sort(),['model','questions','state']);
    assert.equal(payload.state,'Synthetic happy message สุขใจ');
    assert.equal(JSON.stringify(payload).includes('roomId'),false);
    const questions=payload.questions as {selection:{type:string;instructions:string;criteria:Record<string,string>}};
    assert.deepEqual(Object.keys(questions),['selection']);
    assert.equal(questions.selection.type,'choice');
    assert.match(questions.selection.instructions,/meaning is unclear.*🍅 \(tomato\)/);
    assert.deepEqual(questions.selection.criteria,Object.fromEntries(emojiCatalog.map(entry=>[entry.id,`${entry.emoji}: ${entry.name}`])));
  }
  const last=emojiCatalog.at(-1)!;
  selectedId=last.id;
  assert.equal(await client.suggest('Synthetic neutral message'),last.emoji);
  assert.equal(calls,2,'the last catalog option also resolves in one request');
  for(const scenario of ['unsafe','outside-subset','unknown-id','unknown-known-scores']) {
    mode=scenario; const before: number=calls;
    assert.equal(await client.suggest('Unclear synthetic message'),DEFAULT_EMOJI);
    assert.equal(calls-before,1,'an unknown choice uses tomato without another provider request');
  }
  for(const [scenario,expected] of [['http','AI_UNAVAILABLE'],['redirect','AI_UNAVAILABLE'],['invalid-json','AI_INVALID_RESPONSE'],['incomplete','AI_INVALID_RESPONSE'],['bad-sum','AI_INVALID_RESPONSE'],['unknown-bad-sum','AI_INVALID_RESPONSE']]) {
    mode=scenario; const before: number=calls;
    await assert.rejects(client.suggest('synthetic'),error=>error instanceof EmojiError && error.code===expected);
    assert.equal(calls-before,1,'no automatic retry or redirect');
  }
  mode='timeout';
  const short=new ClefSelector({accountId:'0'.repeat(32),token:'synthetic-token'},{endpoint,timeoutMs:100});
  await assert.rejects(short.suggest('synthetic'),error=>error instanceof EmojiError && error.code==='AI_UNAVAILABLE');
  const before=calls;
  await assert.rejects(new ClefSelector({}).suggest('synthetic'),error=>error instanceof EmojiError && error.code==='AI_UNAVAILABLE');
  assert.equal(calls,before);
});

test('global AI concurrency is shared across accounts and capacity is released after completion', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  const group=f.storage.createGroup(f.alice.userId,'Shared limit');
  f.storage.joinGroup(f.bob.userId,group.roomId);
  f.storage.joinGroup(f.charlie.userId,group.roomId);
  const messages=[0,1,2].map(index=>f.storage.sendMessage({senderId:f.alice.userId,roomId:group.roomId,clientMessageId:`shared-limit-${index}`,text:'shared synthetic text'}).message);
  const completions: Array<(emoji:string)=>void>=[];
  const effects=new EmojiEffects(f.storage,{suggest:async()=>new Promise(resolve=>{completions.push(resolve);})},{cooldownMs:0,concurrency:2});
  const sockets=[f.alice,f.bob,f.charlie].map(user=>{
    const socket=new FakeSocket();socket.data.actor={userId:user.userId,name:user.name};effects.register(socket);return socket;
  });
  const payload=(index:number)=>({roomId:group.roomId,messageId:messages[index].messageId});
  const first=sockets[0].trigger('message.emojiSuggest',payload(0));
  const second=sockets[1].trigger('message.emojiSuggest',payload(1));
  assert.equal(code(await sockets[2].trigger('message.emojiSuggest',payload(2))),'AI_RATE_LIMITED');
  assert.equal(completions.length,2);
  completions[0]('😊');assert.equal((await first).ok,true);
  const third=sockets[2].trigger('message.emojiSuggest',payload(2));
  assert.equal(completions.length,3);
  completions[1]('😊');completions[2]('😊');
  assert.equal((await second).ok,true);assert.equal((await third).ok,true);
});

test('one message allows one in-flight selection and then reuses the saved result for every reader', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  let finish!: (emoji:string)=>void;
  let providerCalls=0;
  const emissions: unknown[]=[];
  const effects=new EmojiEffects(f.storage,{suggest:async()=>{providerCalls++;return new Promise(resolve=>{finish=resolve;});}},
    {cooldownMs:0,emitToUser:(...args)=>{emissions.push(args);}});
  const bob=new FakeSocket(); bob.data.actor={userId:f.bob.userId,name:f.bob.name};
  effects.register(f.socket); effects.register(bob);
  const payload={roomId:f.room.roomId,messageId:f.message.messageId};
  const first=f.socket.trigger('message.emojiSuggest',payload);
  assert.equal(code(await bob.trigger('message.emojiSuggest',payload)),'AI_RATE_LIMITED');
  assert.equal(providerCalls,1);
  finish('😊');
  const original=await first;
  const repeated=await bob.trigger('message.emojiSuggest',payload);
  assert.deepEqual(repeated,original);
  assert.deepEqual(await f.socket.trigger('message.emojiSuggest',payload),original);
  assert.equal(providerCalls,1);
  assert.equal(emissions.length,2,'only the first save is delivered to the two eligible readers');
  assert.equal(f.storage.loadHistory({actorId:f.bob.userId,roomId:f.room.roomId}).messages[0].emojis.length,1);
});

test('failed storage never acknowledges or broadcasts a durable emoji success', async t => {
  const f=fixtures(); t.after(()=>f.storage.close());
  const emissions: unknown[]=[];
  const effects=new EmojiEffects(f.storage,{suggest:async()=> '😊'}, {emitToUser:(...args)=>{emissions.push(args);}});
  effects.register(f.socket);
  f.storage.attachMessageEmoji=()=>{throw Error('synthetic private storage failure');};
  const response=await f.socket.trigger('message.emojiSuggest',{roomId:f.room.roomId,messageId:f.message.messageId});
  assert.equal(code(response),'INTERNAL_ERROR');
  assert.equal(JSON.stringify(response).includes('private storage'),false);
  assert.deepEqual(emissions,[]);
  assert.deepEqual(f.storage.loadHistory({actorId:f.alice.userId,roomId:f.room.roomId}).messages[0].emojis,[]);
});
