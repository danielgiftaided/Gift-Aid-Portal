const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const charityId='11111111-1111-1111-1111-111111111111';
function setup(options={}){
 const calls=[],logs=[];
 const db={from(table){const q={select(){return q},eq(key,value){calls.push(['filter',table,key,value]);return q},gt(){return q},limit(){return q},
 maybeSingle:async()=>({data:table==='charities'?(options.missing?null:{id:charityId,name:'Test charity'}):(options.pending??null)}),
 insert(value){calls.push(['insert',table,value]);return q},single:async()=>({data:{id:'invitation'}}),
 update(value){calls.push(['update',table,value]);return q},delete(){calls.push(['delete',table]);return q},
 then(resolve){resolve({error:null})}};return q},
 auth:{admin:{inviteUserByEmail:async(email,metadata)=>{calls.push(['send',email,metadata]);return {data:{user:{id:'auth-user'}},error:options.sendError?{message:'Email rejected'}:null}}}}};
 const dependencies={'../_utils/requireOperator.js':{requireOperator:async()=>{if(options.denied)throw Error('Forbidden');return{id:'operator',email:'operator@example.test'}}},'../_utils/supabase.js':{supabaseAdmin:db},'../_utils/activityLog.js':{logActivity:async value=>logs.push(value)}};
 const exports={};const code=ts.transpileModule(fs.readFileSync('api/admin/invite.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,{exports,require:name=>dependencies[name],console});
 const run=async(body={email:' Contact@Example.test ',charity_id:charityId},method='POST')=>{const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};await exports.default({method,body},res);return res};return{calls,logs,run};
}
test('invitation is bound to the existing workspace in both database and auth metadata',async()=>{
 const e=setup();assert.equal((await e.run()).code,200);const inserted=e.calls.find(c=>c[0]==='insert');assert.equal(inserted[2].charity_id,charityId);assert.equal(inserted[2].email,'contact@example.test');const sent=e.calls.find(c=>c[0]==='send');assert.equal(sent[2].data.charity_id,charityId);assert.equal(sent[2].data.charity_invitation_id,'invitation');assert.equal(e.logs[0].targetId,charityId);assert.ok(e.calls.some(c=>c[0]==='update'&&c[2].auth_user_id==='auth-user'));
});
test('rejects unscoped or invalid invitations before database writes or email sends',async()=>{
 for(const body of [{email:'contact@example.test'},{email:'bad',charity_id:charityId},'{']){const e=setup();assert.equal((await e.run(body)).code,400);assert.equal(e.calls.length,0)}
});
test('requires operator and POST',async()=>{const e=setup({denied:true});assert.equal((await e.run()).code,403);assert.equal(e.calls.length,0);assert.equal((await setup().run({},'GET')).code,405)});
test('missing workspace and active invitation never send an email',async()=>{
 for(const [options,code] of [[{missing:true},404],[{pending:{id:'existing',charity_id:charityId}},409],[{pending:{id:'existing',charity_id:'other'}},409]]){const e=setup(options);assert.equal((await e.run()).code,code);assert.ok(!e.calls.some(c=>c[0]==='send'||c[0]==='insert'))}
});
test('failed email delivery removes only the invitation and preserves the workspace',async()=>{const e=setup({sendError:true});assert.equal((await e.run()).code,400);assert.ok(e.calls.some(c=>c[0]==='delete'&&c[1]==='charity_invitations'));assert.ok(!e.calls.some(c=>c[0]==='delete'&&c[1]==='charities'));assert.equal(e.logs.length,0)});
test('global create flow no longer has an invite field or sends invites',()=>{
 const ui=fs.readFileSync('src/pages/admin.tsx','utf8'),api=fs.readFileSync('api/admin/charities/create.ts','utf8');assert.ok(!ui.includes('inviteEmail'));assert.ok(!api.includes('inviteUserByEmail'));assert.ok(api.includes('if (body.invite_email)'));assert.ok(fs.readFileSync('src/pages/adminCharityDetail.tsx','utf8').includes('<CharityWorkspaceInvite key={id} charityId={id} charityName={charity.name} />'));
});
