(function(){
var doc=document,root=doc.documentElement;
var toggle=doc.querySelector("[data-nav-toggle]"),panel=doc.getElementById("nav-panel");
if(!toggle||!panel)return;
var main=doc.querySelector("main"),foot=doc.querySelector("footer"),close=panel.querySelector("[data-nav-close]");
function set(open){
if(open)root.setAttribute("data-nav-open","");else root.removeAttribute("data-nav-open");
toggle.setAttribute("aria-expanded",open?"true":"false");
if(main)main.inert=open;
if(foot)foot.inert=open;
if(open)requestAnimationFrame(function(){(close||panel).focus()});else toggle.focus();
}
toggle.addEventListener("click",function(){set(!root.hasAttribute("data-nav-open"))});
if(close)close.addEventListener("click",function(){set(false)});
doc.addEventListener("keydown",function(e){if(e.key==="Escape"&&root.hasAttribute("data-nav-open"))set(false)});
})();
