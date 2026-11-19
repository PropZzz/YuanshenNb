const direct=new Set(["focus","login","register","calendar","microtasks","team","profile","goals","review","integrations","bluetooth","energy","diagnostics","settings"]);
export function resolveReferenceRoute(path:string,search=""):string|null {
 const name=path.replace(/^\//,"").replace(/\/$/,"");if(!name||name.includes("/"))return null;
 const query=new URLSearchParams(search),finish=(route:string)=>`/${route}${query.size?`?${query}`:""}`;
 if(direct.has(name))return finish(name);
 if(name==="schedule"||name==="smart-calendar")return finish("calendar");
 if(["micro","micro-tasks"].includes(name))return finish("microtasks");
 if(["emotion-energy","emotion"].includes(name))return finish("energy");
 if(name==="mcp")return finish("integrations");
 if(name==="settings-drawer"){query.set("preferences","1");return finish("focus");}
 if(["microtask-entry","microtask-entry-breakdown"].includes(name)){query.set("panel","entry");return finish("microtasks");}
 if(name==="microtask-detail"){query.set("task",query.get("id")??"missing");query.delete("id");return finish("microtasks");}
 if(name==="create-schedule"){query.set("new","1");return finish("calendar");}
 if(name==="schedule-detail"){query.set("detail",query.get("id")??"missing");query.delete("id");return finish("calendar");}
 if(["urgent-task","insert-urgent-task","rescue-comparison","urgent-rescue-comparison"].includes(name)){query.set("rescue","1");return finish("calendar");}
 if(name==="calendar-options"){query.set("options","1");return finish("calendar");}
 if(["calendar-import","import-schedule"].includes(name)){query.set("import","1");return finish("calendar");}
 return null;
}
