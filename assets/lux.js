(function(){
var doc=document,root=doc.documentElement;
var toggle=doc.querySelector("[data-nav-toggle]"),panel=doc.getElementById("nav-panel");
if(!toggle||!panel)return;
var main=doc.querySelector("main"),foot=doc.querySelector("footer"),close=panel.querySelector("[data-nav-close]");
var outside=[].filter.call(doc.querySelectorAll(".skip,.site-header__brand,.site-header__mobile a"),function(el){return !panel.contains(el)&&el!==toggle});
if(!panel.hasAttribute("role")){panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true")}
if(!panel.hasAttribute("aria-label")&&!panel.hasAttribute("aria-labelledby"))panel.setAttribute("aria-label","Site menu");
function set(open){
if(open)root.setAttribute("data-nav-open","");else root.removeAttribute("data-nav-open");
toggle.setAttribute("aria-expanded",open?"true":"false");
if(main)main.inert=open;
if(foot)foot.inert=open;
outside.forEach(function(el){el.inert=open});
if(!open){toggle.focus();return}
var target=close||panel;
if(!close)panel.tabIndex=-1;
requestAnimationFrame(function(){requestAnimationFrame(function(){
target.focus();
if(doc.activeElement!==target)panel.addEventListener("transitionend",function once(){target.focus();panel.removeEventListener("transitionend",once)})
})});
}
toggle.addEventListener("click",function(){set(!root.hasAttribute("data-nav-open"))});
if(close)close.addEventListener("click",function(){set(false)});
doc.addEventListener("keydown",function(e){if(e.key==="Escape"&&root.hasAttribute("data-nav-open"))set(false)});
})();
