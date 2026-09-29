(function(){
var doc=document,root=doc.documentElement;
var toggle=doc.querySelector("[data-nav-toggle]"),panel=doc.getElementById("nav-panel");
if(!toggle||!panel)return;
var main=doc.querySelector("main"),foot=doc.querySelector("footer"),close=panel.querySelector("[data-nav-close]");
var outside=[].filter.call(doc.querySelectorAll(".skip,a.site-header__brand,.site-header__desk,.site-header__mobile a,.site-nav"),function(el){return !panel.contains(el)&&el!==toggle&&!el.contains(toggle)});
var wide=window.matchMedia("(min-width:56.25em)");
panel.role="dialog";panel.ariaModal="true";panel.ariaLabel="Site menu";
function isOpen(){return root.hasAttribute("data-nav-open")}
function set(open){
if(open)root.setAttribute("data-nav-open","");else root.removeAttribute("data-nav-open");
toggle.ariaExpanded=open;
main.inert=foot.inert=open;
outside.forEach(function(el){el.inert=open});
if(!open){toggle.focus({preventScroll:true});return}
var tries=0;
(function attempt(){
close.focus({preventScroll:true});
if(doc.activeElement!==close&&++tries<12)requestAnimationFrame(attempt);
})();
}
toggle.addEventListener("click",function(){set(!isOpen())});
close.addEventListener("click",function(){set(false)});
doc.addEventListener("keydown",function(e){if(e.key==="Escape"&&isOpen())set(false)});
doc.addEventListener("click",function(e){
if(!isOpen())return;
if(panel.contains(e.target)||toggle.contains(e.target))return;
set(false);
});
wide.addEventListener("change",function(){if(wide.matches&&isOpen())set(false)});
})();
(function(){
var d=document,w=window,last,home=d.querySelector(".home");
d.addEventListener("focusin",function(e){e.target.closest(".fleet-grid")&&e.target.scrollIntoView({block:"nearest"})});
if(!w.matchMedia("(prefers-reduced-motion:no-preference)").matches)return;
if(w.IntersectionObserver&&!home){
var io=new IntersectionObserver(function(es){
var n=0;
es.forEach(function(e){
var t=e.target;
if(!t.hasAttribute("data-rv")){if(e.isIntersecting)io.unobserve(t);else t.setAttribute("data-rv","0");return}
if(e.intersectionRatio<.15)return;
t.style.setProperty("--rv-d",Math.min(n++,5)*.08+"s");
t.setAttribute("data-rv","1");
io.unobserve(t);
});
},{threshold:[0,.15]});
[].forEach.call(d.querySelectorAll("main :is(.plate:not(.plate--thumb),.citymap:not(.citymap--hero))"),function(t){
if(!t.querySelector("[loading=eager]"))io.observe(t);
});
}
d.addEventListener("click",function(e){last=e.target.closest&&e.target.closest("a[href]")},true);
w.addEventListener("pageswap",function(e){
var u=e.activation&&e.activation.entry&&e.activation.entry.url,c=last&&last.closest(".note,.frame>article"),p=c&&c.querySelector(".plate"),h=d.querySelector("img[loading=eager]"),s=d.querySelector(".site-header"),r;
h=h&&h.closest(".plate");
r=h&&h.getBoundingClientRect();
if(e.viewTransition&&r&&(r.top<(s?s.getBoundingClientRect().bottom:0)-1||r.top>=innerHeight))h.style.viewTransitionName="none";
if(!e.viewTransition||!p||!u||u.split("#")[0]!==last.href.split("#")[0])return;
if(h)h.style.viewTransitionName="none";
p.style.viewTransitionName="hero";
});
w.addEventListener("pagereveal",function(e){
if(home&&e.viewTransition)e.viewTransition.skipTransition();
var clr=function(){[].forEach.call(d.querySelectorAll(".plate[style]"),function(x){x.style.viewTransitionName=""})};
e.viewTransition?e.viewTransition.finished.then(clr,clr):clr();
});
})();
(function(){
var f=document.querySelector(".trip");
if(!f)return;
var E=f.elements,q=function(s){return f.querySelector(s)},v=function(n){return E[n].value.trim()},book=q(".trip__book"),msg=q(".trip__msg"),flt=q(".trip__flt");
E.date.min=new Date().toLocaleDateString("en-CA");
function read(){
var h=E["trip-type"].value=="hour";
q(".trip__drop").hidden=h;
q(".trip__hours").hidden=!h;
flt.hidden=!/\b(jfk|laguardia|lga|newark|ewr|teterboro|teb)\b|airport/i.test(v("pickup"));
return{hourly:h,pickup:v("pickup"),dropoff:v("dropoff"),date:v("date"),time:v("time"),passengers:v("passengers"),hours:v("hours"),flight:flt.hidden?"":v("flight")};
}
function text(f){
var h=+f.time.slice(0,2);
return["Hi NYC LUX RIDE, I'd like to book a car.","Trip: "+(f.hourly?"By the hour, "+f.hours+" hours":"One way"),f.pickup&&"Pickup: "+f.pickup,!f.hourly&&f.dropoff&&"Drop-off: "+f.dropoff,f.date&&"Date: "+new Date(f.date+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}),f.time&&"Time: "+(h%12||12)+f.time.slice(2)+(h<12?" AM":" PM"),"Passengers: "+f.passengers,f.flight&&"Flight: "+f.flight].filter(Boolean).join("\n");
}
function check(s){
var bad=[["pickup","a pickup"],["dropoff","a drop-off",s.hourly],["date",E.date.validity.rangeUnderflow?"a future date":"a date"],["time","a time"]].filter(function(r){
return E[r[0]].ariaInvalid=!r[2]&&(!s[r[0]]||E[r[0]].validity.rangeUnderflow);
});
var t=bad.length?"Add "+bad.map(function(r){return r[1]}).join(", ").replace(/, (?=[^,]*$)/," and ")+".":"";
if(msg.textContent!=t)msg.textContent=t;
return bad[0]&&E[bad[0][0]];
}
function update(){
var s=read();
q(".trip__wa").href="https://wa.me/16467750556?text="+encodeURIComponent(text(s));
if(msg.textContent)check(s);
}
f.addEventListener("input",update);
addEventListener("pageshow",update);
addEventListener("click",function(e){
var el=book.contains(e.target)&&check(read());
if(el){e.preventDefault();e.stopPropagation();el.focus()}
},true);
update();
})();
