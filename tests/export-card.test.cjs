const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const {renderToStaticMarkup}=require('react-dom/server');
function load(path,dependencies){const exports={};const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:name=>dependencies[name]??require(name)});return exports}
function buttons(node){if(!node||typeof node!=='object')return [];return [node.type==='button'?node:null,...[node.props?.children].flat(Infinity).flatMap(buttons)].filter(Boolean)}
test('export card reveals action on back, returns with Back or Escape and blocks empty export',()=>{
 let flipped=false,exports=0;
 const Card=load('src/components/ExportFlipCard.tsx',{react:{useState:()=>[flipped,value=>{flipped=value}],useRef:()=>({current:null}),useEffect:()=>{}}}).default;
 const props={label:'Full file',value:4,description:'All uploaded records',onExport:()=>exports++};
 let card=Card(props);let html=renderToStaticMarkup(card);assert.ok(!html.includes('Export CSV'));assert.ok(html.includes('Show download options'));
 buttons(card)[0].props.onClick();assert.equal(flipped,true);assert.equal(exports,0);
 card=Card(props);assert.ok(renderToStaticMarkup(card).includes('Export CSV'));buttons(card).find(button=>button.props.children==='Export CSV').props.onClick();assert.equal(exports,1);
 card.props.children.props.onKeyDown({key:'Escape'});assert.equal(flipped,false);
 flipped=true;card=Card({...props,value:0});assert.equal(buttons(card).find(button=>button.props.children==='Export CSV').props.disabled,true);
 buttons(card).find(button=>button.props.children==='Back').props.onClick();assert.equal(flipped,false);
 card=Card({...props,onExport:undefined});assert.equal(buttons(card).length,0);
});
test('shared chart tooltip formats currency and counts and remains hidden when inactive',()=>{
 const {InsightTooltip}=load('src/components/InsightTooltip.tsx',{});
 const props={active:true,label:'2025/26',payload:[{name:'Gift Aid',value:12345.67,color:'#0c745d'}],currency:true};
 assert.match(renderToStaticMarkup(InsightTooltip(props)),/£12,345\.67/);
 assert.match(renderToStaticMarkup(InsightTooltip({...props,currency:false,payload:[{name:'Records',value:240}]})),/>240</);
 assert.equal(InsightTooltip({...props,active:false}),null);
});
