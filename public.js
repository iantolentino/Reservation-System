(() => {
  const preview = location.hostname.endsWith(".vercel.app");
  const key = "assembly-room-scheduler-v1";
  const today = new Date();
  const iso = date => date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
  const safe = value => String(value || "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let data = { rooms: [], reservations: [] };

  function previewData() {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (stored?.rooms && stored?.reservations) return stored;
    } catch (_) {}
    const d = "2026-08-25";
    return { rooms: [
      {id:"room-m6a-training",name:"M6A Training Room",capacity:30,status:"Available"},
      {id:"room-m6b-lounge",name:"M6B Client Lounge",capacity:18,status:"Available"},
      {id:"room-m6b-meeting",name:"M6B Meeting Room",capacity:12,status:"Available"},
      {id:"room-m5b-conference",name:"M5B Conference Room",capacity:16,status:"Available"},
      {id:"room-m4a-workshop",name:"M4A Workshop Room",capacity:24,status:"Available"}
    ], reservations:[
      {roomId:"room-m6a-training",date:d,startDate:d,endDate:d,startTime:"07:00",endTime:"09:00",department:"Learning & Development",status:"Approved",assignmentStatus:"Assigned"},
      {roomId:"room-m6b-meeting",date:d,startDate:d,endDate:d,startTime:"09:30",endTime:"10:30",department:"Finance",status:"Approved",assignmentStatus:"Assigned"},
      {roomId:"room-m5b-conference",date:d,startDate:d,endDate:d,startTime:"13:00",endTime:"14:00",department:"Operations",status:"Approved",assignmentStatus:"Assigned"}
    ]};
  }

  function reservationsFor(date) {
    return (data.reservations || []).filter(item => {
      const start = item.startDate || item.date;
      const end = item.endDate || item.date || start;
      return start <= date && end >= date && item.status === "Approved" && item.assignmentStatus !== "Unassigned";
    }).sort((a,b) => a.startTime.localeCompare(b.startTime));
  }

  function renderDayList(date) {
    const list = document.getElementById("selected-day-list");
    const title = document.getElementById("selected-day-title");
    title.textContent = new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(date+"T00:00:00"));
    const rows = reservationsFor(date);
    list.innerHTML = rows.length
      ? "<ul>" + rows.map(item => "<li><strong>" + safe(item.department || "Department") + "</strong> · " + safe(item.startTime) + "–" + safe(item.endTime) + "</li>").join("") + "</ul>"
      : '<div class="public-empty">No confirmed bookings for this day.</div>';
  }

  function renderCalendar() {
    const label = document.getElementById("month-label");
    label.textContent = new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(month);
    const first = new Date(month.getFullYear(),month.getMonth(),1);
    const gridStart = new Date(first);
    gridStart.setDate(1-((first.getDay()+6)%7));
    const names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const nodes = names.map(name => '<div class="public-weekday">'+name+'</div>');
    for(let i=0;i<42;i++){
      const date = new Date(gridStart); date.setDate(gridStart.getDate()+i);
      const day = iso(date);
      const events = reservationsFor(day);
      const markup = events.slice(0,2).map(item => '<span class="public-booking"><time>'+safe(item.startTime)+'–'+safe(item.endTime)+'</time>'+safe(item.department||"Department")+'</span>').join("");
      const more = events.length>2 ? '<span class="public-empty">+'+(events.length-2)+' more</div>' : "";
      nodes.push('<button type="button" class="public-day '+(date.getMonth()===month.getMonth()?"":"other-month")+' '+(day===iso(today)?"today":"")+'" data-date="'+day+'"><span class="public-day-number">'+date.getDate()+'</span>'+(markup||(!events.length?'<span class="public-empty">Open</span>':""))+more+'</button>');
    }
    const calendar=document.getElementById("calendar");
    calendar.innerHTML=nodes.join("");
    calendar.querySelectorAll("[data-date]").forEach(button=>button.addEventListener("click",()=>renderDayList(button.dataset.date)));
    renderDayList(iso(today));
  }

  function loadRooms() {
    const select=document.getElementById("room-select");
    const rooms=(data.rooms||[]).filter(room=>room.status!=="Disabled"&&room.status!=="Under Maintenance");
    select.innerHTML=rooms.map(room=>'<option value="'+safe(room.id)+'">'+safe(room.name)+' · '+Number(room.capacity||0)+' seats</option>').join("");
  }

  function showMessage(message,error=false) {
    document.getElementById("form-message").innerHTML='<div class="public-alert '+(error?"error":"")+'">'+safe(message)+'</div>';
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const values=Object.fromEntries(new FormData(form).entries());
    const urgent=document.getElementById("urgent-request").checked;
    const start=values.startTime, end=values.endTime;
    if(!start||!end||end<=start) return showMessage("Choose an end time after the start time.",true);
    const duration=(Number(end.slice(0,2))*60+Number(end.slice(3)))-(Number(start.slice(0,2))*60+Number(start.slice(3)));
    if(urgent&&duration>30) return showMessage("Urgent bookings can be no longer than 30 minutes.",true);
    const room=data.rooms.find(item=>item.id===values.roomId);
    if(!room) return showMessage("Choose an available room.",true);
    if(Number(values.attendees)>Number(room.capacity||0)) return showMessage("This room does not have enough seats for the attendee count.",true);
    const candidate={id:"public-"+Date.now(),roomId:values.roomId,date:values.date,startDate:values.date,endDate:values.date,startTime:start,endTime:end,timeType:"range",reservedFor:values.department,eventName:values.eventName,requestedBy:values.requestedBy,department:values.department,attendees:Number(values.attendees),remarks:values.remarks||"",status:"Pending",assignmentStatus:"Assigned",urgent,createdAt:new Date().toISOString()};
    const conflict=(data.reservations||[]).find(item=>item.roomId===candidate.roomId&&item.status!=="Cancelled"&&item.status!=="Rejected"&&item.assignmentStatus!=="Unassigned"&&(item.startDate||item.date)<=candidate.date&&(item.endDate||item.date)>=candidate.date&&(item.startTime<candidate.endTime&&item.endTime>candidate.startTime));
    if(conflict) return showMessage("That room is already reserved for part of this time. Choose another time or room.",true);
    if(preview){
      data.reservations.push(candidate);
      localStorage.setItem(key,JSON.stringify(data));
      renderCalendar();
      showMessage("Request submitted for staff approval. In this preview, it is stored in this browser only.");
      form.reset();
      document.getElementById("request-date").value=iso(today);
      return;
    }
    try{
      const response=await fetch("/api/public/requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(candidate)});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Could not submit the request.");
      showMessage("Request submitted for staff approval. Reference: "+result.id);
      form.reset();
      document.getElementById("request-date").value=iso(today);
      await loadData();
    }catch(error){showMessage(error.message||"Could not submit the request. Please try again.",true);}
  }

  async function loadData() {
    if(preview){data=previewData();const first=(data.reservations||[]).find(item=>item.startDate||item.date);if(first){const d=new Date((first.startDate||first.date)+"T00:00:00");month=new Date(d.getFullYear(),d.getMonth(),1);}}
    else {
      const response=await fetch("/api/public/bootstrap",{headers:{"Accept":"application/json"}});
      if(!response.ok) throw new Error("Could not load the public room calendar.");
      data=await response.json();
    }
    loadRooms();
    renderCalendar();
  }

  document.getElementById("prev-month").addEventListener("click",()=>{month.setMonth(month.getMonth()-1);renderCalendar();});
  document.getElementById("next-month").addEventListener("click",()=>{month.setMonth(month.getMonth()+1);renderCalendar();});
  document.getElementById("public-request-form").addEventListener("submit",submitRequest);
  const dateField=document.getElementById("request-date");
  dateField.min=iso(today); dateField.value=iso(today);
  document.getElementById("start-time").value=String(today.getHours()).padStart(2,"0")+":00";
  document.getElementById("end-time").value=String((today.getHours()+1)%24).padStart(2,"0")+":00";
  document.getElementById("urgent-request").addEventListener("change",event=>{
    if(event.target.checked){
      const start=document.getElementById("start-time").value;
      const [hours,minutes]=start.split(":").map(Number);
      const endMinutes=Math.min(1439,hours*60+minutes+30);
      document.getElementById("end-time").value=String(Math.floor(endMinutes/60)%24).padStart(2,"0")+":"+String(endMinutes%60).padStart(2,"0");
    }
  });
  loadData().catch(error=>showMessage(error.message,true));
})();