import { test,expect,Page } from '@playwright/test';
const task={id:'a',title:'閱讀 20 分鐘',description:'讀完今天的故事',points:5,isRecurring:true,recurringType:'daily',keepAfterCompletion:true,maxCompletions:null,completions:[],myStatus:'READY'};
const award={id:'award',challengeId:'challenge',userId:'child',user:{id:'child',name:'小星'},localDate:'2026-09-07',title:'每日閱讀',bonusStars:0,customTitle:'玩電動 30 分鐘',customDescription:'晚餐後一起玩',earnedAt:'2026-09-07T04:00:00Z',fulfilledAt:null};
async function mock(page:Page,role='CHILD',options:{lost?:boolean}={}) {
  let status='READY',submits=0,fulfills=0,fulfilled=false;
  const saved:any[]=[];
  await page.addInitScript(()=>localStorage.setItem('token','test-token'));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    let json:any={};
    if(path==='/api/auth/me')json={user:{id:role==='CHILD'?'child':'parent',name:'測試使用者',email:'test@test.invalid',role,points:10}};
    else if(path==='/api/tasks')json={localDate:'2026-09-07',tasks:[{...task,myStatus:status}]};
    else if(path==='/api/tasks/a/complete'){
      submits++;status='PENDING';await new Promise(r=>setTimeout(r,600));
      if(options.lost){await route.abort('failed');return;}
      json={completion:{id:'completion',status:'PENDING',localDate:'2026-09-07'}};
    }
    else if(path==='/api/tasks/challenges'&&route.request().method()==='POST'){saved.push(route.request().postDataJSON());json={success:true};}
    else if(path==='/api/tasks/challenges')json={localDate:'2026-09-07',settings:[],children:role==='CHILD'?[]:[{id:'child',name:'小星'}],progress:[{id:'challenge',title:'每日閱讀',user:{id:'child',name:'小星'},localDate:'2026-09-07',taskIds:['a'],childIds:['child'],tasks:[{id:'a',title:task.title,status:status==='PENDING'?'PENDING':'READY'}],bonusStars:0,customTitle:award.customTitle,isActive:true,award:null}],awards:[{...award,fulfilledAt:fulfilled?'2026-09-07T05:00:00Z':null}]};
    else if(path==='/api/tasks/challenge-awards/award/fulfill'){fulfills++;await new Promise(r=>setTimeout(r,300));fulfilled=true;json={success:true};}
    else if(path==='/api/reports/monthly')json={month:'2026-09',timezone:'Asia/Taipei',family:{id:'family',name:'測試家庭'},familySummary:{earned:10,spent:0,deducted:0,tasks:3,allowanceTwd:0,trophies:0},children:[{user:{id:'child',name:'小星'},summary:{openingPoints:0,earned:10,rewardSpent:0,allowanceSpent:0,deducted:0,reversed:0,closingPoints:10},taskSummary:{approvedCount:3,rejectedCount:0,totalPoints:10,topTasks:['閱讀']},challengeSummary:{bonusStars:0,awards:[award]},allowanceTwd:0,trophies:[],transactions:[]}]};
    else if(path==='/api/families/me')json={family:{id:'family',members:[{user:{id:'child',name:'小星',role:'CHILD'}}]}};
    else if(path.includes('/tasks/groups'))json={groups:[]};
    else if(path.includes('/rewards'))json={rewards:[],redemptions:[],wishes:[]};
    else if(path.includes('/balance'))json={availablePoints:10};
    else json={wishes:[],redemptions:[],groups:[]};
    await route.fulfill({json});
  });
  return {submits:()=>submits,fulfills:()=>fulfills,saved};
}
test('mobile submission gives immediate feedback, rejects rapid clicks, survives reload',async({page})=>{
  await page.setViewportSize({width:360,height:800});const state=await mock(page);
  await page.goto('/app/tasks');
  const complete=page.getByRole('button',{name:'完成',exact:true});
  await complete.evaluate((el:HTMLButtonElement)=>{el.click();el.click();el.click();});
  await expect(page.getByRole('button',{name:'送出中…'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'等待家長審核'})).toBeDisabled();
  expect(state.submits()).toBe(1);
  await page.reload();await expect(page.getByRole('button',{name:'等待家長審核'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile-task.png',fullPage:true});
});
test('lost response reconciles to pending without resubmitting',async({page})=>{
  const state=await mock(page,'CHILD',{lost:true});await page.goto('/app/tasks');await page.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByText('已確認送出，等待家長審核。')).toBeVisible();expect(state.submits()).toBe(1);
});
for(const width of [360,390,768])for(const role of ['CHILD','PARENT'])test(`monthly report ${role} at ${width}px and print`,async({page})=>{
  await page.setViewportSize({width,height:844});await mock(page,role);await page.goto('/app/more');
  await page.getByRole('navigation',{name:'更多功能'}).getByRole('link',{name:'月報',exact:true}).click();
  await expect(page.getByRole('heading',{name:'每月回顧'})).toBeVisible();
  await expect(page.getByText('玩電動 30 分鐘',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/report-${role}-${width}.png`,fullPage:true});
  await page.emulateMedia({media:'print'});
  await expect(page.getByRole('navigation',{name:'手機主要導覽'})).toBeHidden();
  await expect(page.getByText('玩電動 30 分鐘',{exact:false})).toBeVisible();
});
test('parent can configure custom-only reward and fulfill with no duplicate action',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await mock(page,'PARENT');await page.goto('/app/tasks');
  await page.getByRole('button',{name:'新增挑戰',exact:true}).click();
  await page.getByLabel('挑戰名稱').fill('睡前挑戰');await page.getByRole('checkbox',{name:/閱讀 20/}).check();await page.getByRole('checkbox',{name:'小星',exact:true}).check();
  await page.getByRole('combobox',{name:'額外獎勵',exact:true}).selectOption('custom');await page.getByLabel('自訂獎勵名稱').fill('選擇週末晚餐');await page.getByRole('button',{name:'儲存挑戰'}).click();
  await expect.poll(()=>state.saved.length).toBe(1);expect(state.saved[0].bonusStars).toBe(0);expect(state.saved[0].customTitle).toBe('選擇週末晚餐');
  await page.goto('/app/rewards');const fulfill=page.getByRole('button',{name:'標記已兌現'});
  await fulfill.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(page.getByText('已兌現',{exact:true})).toBeVisible();expect(state.fulfills()).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('child has no fulfillment control and More is keyboard accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('/app/rewards');
  await expect(page.getByRole('button',{name:'標記已兌現'})).toHaveCount(0);
  const more=page.getByRole('navigation',{name:'手機主要導覽'}).getByRole('link',{name:'更多'});
  await more.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'更多'})).toBeVisible();
  const report=page.getByRole('navigation',{name:'更多功能'}).getByRole('link',{name:'月報'});await report.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'每月回顧'})).toBeVisible();
});

test('large text and unavailable session storage still permit a single submission',async({page})=>{
  await page.setViewportSize({width:360,height:800});const state=await mock(page);
  await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage disabled');}}));
  await page.goto('/app/tasks');await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('button',{name:'等待家長審核'})).toBeDisabled();
  expect(state.submits()).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
