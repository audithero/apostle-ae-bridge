// Report every super's visible window in MASTER time, for VO cross-check.
$.global.APVERIFY = function (masterName) {
  if (typeof $.global.APOSTLE === "undefined") { $.evalFile(new File(($.global.APOSTLE_REPO || new File($.fileName).parent.parent.fsName) + "/apostle/apostle.jsx")); }
  var p=app.project, m=null;
  for (var i=1;i<=p.numItems;i++){var it=p.item(i); if (it instanceof CompItem && it.name===masterName) m=it;}
  if (!m) return {error:"not found "+masterName};
  var o={master:masterName, dur:Math.round(m.duration*100)/100, vo:null, supers:[]};
  for (var j=1;j<=m.numLayers;j++){
    var L=m.layer(j);
    if (L.name.indexOf("AUDIO VOICE OVER")>=0){ if(!o.vo) o.vo={start:L.startTime, out:Math.round(L.outPoint*100)/100}; continue; }
    if (!(L.source instanceof CompItem)) continue;
    if (L.comment === "apostle backdrop") continue;
    var c=L.source;
    for (var k=1;k<=c.numLayers;k++){
      var X=c.layer(k);
      if (X.name.indexOf("SUPER")!==0 && X.name!=="Super") continue;
      var op=X.property("ADBE Transform Group").property("ADBE Opacity");
      var vis=[];
      for (var q=1;q<=op.numKeys;q++) if (Math.round(op.keyValue(q))===100) vis.push(L.startTime+op.keyTime(q));
      if (!vis.length) continue;
      var t=null; try{t=X.property("Source Text").value.toString();}catch(e){}
      o.supers.push({a:Math.round(vis[0]*100)/100, b:Math.round(vis[vis.length-1]*100)/100, txt:t});
    }
  }
  o.supers.sort(function(x,y){return x.a-y.a;});
  return o;
};
