const clinicThemes=[
  {id:"sky",name:"天蓝",colors:["#236f9b","#3198d0","#61b9e7"],vars:{"--bg":"#f5f9fc","--text":"#263744","--muted":"#748895","--line":"#e2edf3","--green":"#268bc5","--green2":"#e4f4fc","--blue":"#268bc5","--shadow":"0 12px 34px rgba(46,111,147,.09)"},sidebar:"#236f9b",hero:"linear-gradient(120deg,#3198d0,#61b9e7)",soft:"#e2f3fb",toast:"#256f98"},
  {id:"mint",name:"薄荷绿",colors:["#167866","#23a88d","#72ceb9"],vars:{"--bg":"#f4faf8","--text":"#263b38","--muted":"#718b86","--line":"#deeee9","--green":"#188b74","--green2":"#e3f6f1","--blue":"#318ca2","--shadow":"0 12px 34px rgba(35,111,96,.09)"},sidebar:"#176d61",hero:"linear-gradient(120deg,#198c77,#5cc4ac)",soft:"#e2f5f0",toast:"#176d61"},
  {id:"red",name:"医疗红",colors:["#8f1f29","#c92532","#e16a72"],vars:{"--bg":"#faf7f7","--text":"#30292a","--muted":"#867a7b","--line":"#eee5e6","--green":"#c92532","--green2":"#fbe8e9","--blue":"#9b6570","--shadow":"0 12px 34px rgba(105,46,51,.08)"},sidebar:"#8f1f29",hero:"linear-gradient(120deg,#b51f2c,#dc3d49)",soft:"#fae7e9",toast:"#79212a"},
  {id:"navy",name:"深海蓝",colors:["#244c74","#326a9d","#6a9bc4"],vars:{"--bg":"#f5f8fb","--text":"#273746","--muted":"#768594","--line":"#e2eaf1","--green":"#326a9d","--green2":"#e6eff7","--blue":"#326a9d","--shadow":"0 12px 34px rgba(42,78,112,.09)"},sidebar:"#244c74",hero:"linear-gradient(120deg,#2c6496,#5d94bd)",soft:"#e5eff7",toast:"#244c74"},
  {id:"lavender",name:"薰衣草",colors:["#66558f","#8b78b6","#b7a6d8"],vars:{"--bg":"#f8f6fb","--text":"#3d3748","--muted":"#897f96","--line":"#ebe6f1","--green":"#806dad","--green2":"#eee9f6","--blue":"#806dad","--shadow":"0 12px 34px rgba(92,73,128,.09)"},sidebar:"#66558f",hero:"linear-gradient(120deg,#806dad,#ad9ad0)",soft:"#eee9f6",toast:"#66558f"},
  {id:"orange",name:"暖橙",colors:["#a75b26","#db7e38","#eeae74"],vars:{"--bg":"#fcf8f4","--text":"#43372f","--muted":"#938173","--line":"#f1e7de","--green":"#cb7133","--green2":"#faeee5","--blue":"#a97b5a","--shadow":"0 12px 34px rgba(137,83,43,.09)"},sidebar:"#a75b26",hero:"linear-gradient(120deg,#c86d2e,#e8995c)",soft:"#faeee5",toast:"#955122"},
  {id:"graphite",name:"石墨灰",colors:["#394b55","#59717c","#8da2aa"],vars:{"--bg":"#f6f8f8","--text":"#2f3c41","--muted":"#7b8b91","--line":"#e4eaeb","--green":"#526f7c","--green2":"#e8eff1","--blue":"#526f7c","--shadow":"0 12px 34px rgba(55,78,86,.09)"},sidebar:"#394b55",hero:"linear-gradient(120deg,#4a6570,#7c969f)",soft:"#e7eff1",toast:"#394b55"}
];
function applyClinicTheme(id){
  const theme=clinicThemes.find(x=>x.id===id)||clinicThemes[0],root=document.documentElement;
  Object.entries(theme.vars).forEach(([k,v])=>root.style.setProperty(k,v));
  root.style.setProperty("--clinic-sidebar",theme.sidebar);root.style.setProperty("--clinic-hero",theme.hero);root.style.setProperty("--clinic-soft",theme.soft);root.style.setProperty("--clinic-toast",theme.toast);
  localStorage.setItem("clinic-theme",theme.id);
  document.querySelectorAll("[data-theme]").forEach(x=>x.classList.toggle("selected",x.dataset.theme===theme.id));
}
function setupThemePicker(){
  const menu=document.getElementById("themeMenu"),toggle=document.getElementById("themeToggle");if(!menu||!toggle)return;
  menu.innerHTML=clinicThemes.map(x=>`<button type="button" class="theme-option" data-theme="${x.id}"><span class="theme-colors">${x.colors.map(c=>`<i style="background:${c}"></i>`).join("")}</span><strong>${x.name}</strong></button>`).join("");
  toggle.onclick=()=>menu.classList.toggle("open");
  menu.onclick=e=>{const button=e.target.closest("[data-theme]");if(!button)return;applyClinicTheme(button.dataset.theme);menu.classList.remove("open")};
  document.addEventListener("click",e=>{if(!e.target.closest(".theme-picker"))menu.classList.remove("open")});
}
applyClinicTheme(localStorage.getItem("clinic-theme")||"sky");setupThemePicker();
