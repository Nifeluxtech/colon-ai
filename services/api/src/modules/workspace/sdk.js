// The script a site loads to use its Colon data (v0.29.0, Workspace step 5), served by GET /sites/:key/colon.js:
//   <script src="https://api.apparatus.name.ng/sites/<key>/colon.js"></script>
//   await Colon.data('orders').add({ name, phone })      -> { id }
//   await Colon.data('orders').list({ limit: 20 })        -> [{ id, data, created_at }]
//   await Colon.call('WEATHER_KEY', '/v1/now?city=Lagos') -> the API's answer (JSON parsed), the key added by Colon
// Plain ES5 so it runs in every browser; no cookies are sent (the public routes never read a session).

function sdk(key) {
  const k = JSON.stringify(String(key));
  return `/* Colon site data · https://apparatus.name.ng */
(function(){var K=${k};var s=document.currentScript&&document.currentScript.src||"";
var B=s?s.replace(/\\/sites\\/[^/]+\\/colon\\.js.*$/,""):"https://api.apparatus.name.ng";
function req(m,p,b){return fetch(B+"/sites/"+encodeURIComponent(K)+p,{method:m,credentials:"omit",
headers:b?{"Content-Type":"application/json"}:{},body:b?JSON.stringify(b):undefined}).then(function(r){
return r.json().catch(function(){return {}}).then(function(j){if(!r.ok){var e=new Error(j.message||("Colon "+r.status));
e.status=r.status;e.code=j.error;throw e}return j})})}
function q(o){var a=[];for(var k in o||{})if(o[k]!=null)a.push(encodeURIComponent(k)+"="+encodeURIComponent(o[k]));
return a.length?"?"+a.join("&"):""}
window.Colon={key:K,data:function(n){var p="/data/"+encodeURIComponent(n);return{
list:function(o){return req("GET",p+q(o)).then(function(j){return j.records})},
page:function(o){return req("GET",p+q(o))},
add:function(d){return req("POST",p,{data:d})}}},
call:function(name,path,o){o=o||{};return req("POST","/call/"+encodeURIComponent(name),{path:path||"/",
method:o.method||"GET",query:o.query,body:o.body}).then(function(j){if(!j.ok){var e=new Error("API answered "+j.status);
e.status=j.status;e.data=j.data;throw e}return j.data})}};})();
`;
}

module.exports = { sdk };
