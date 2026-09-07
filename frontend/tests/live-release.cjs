// Explicit release smoke only; not discovered by the regular Playwright test suite.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const state=JSON.parse(fs.readFileSync(path.join(__dirname,'../../backend/.release/smoke.json'),'utf8'));
if(!state.verified)throw Error('API smoke must pass first');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const role of ['PARENT','CHILD']){
      const session=state.users.find(u=>u.user.role===role);
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.addInitScript(token=>localStorage.setItem('token',token),session.token);
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('https://starjat.vercel.app/app/tasks');
      await page.getByRole('heading',{name:'每日挑戰',exact:true}).waitFor();
      await page.getByText('Smoke daily combo',{exact:false}).first().waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(__dirname,`../../backend/.release/live-tasks-${role}.png`),fullPage:true});
      await page.getByRole('navigation',{name:'手機主要導覽'}).getByRole('link',{name:'更多'}).click();
      await page.getByRole('navigation',{name:'更多功能'}).getByRole('link',{name:'月報',exact:true}).click();
      await page.getByText('Smoke custom reward',{exact:false}).waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(__dirname,`../../backend/.release/live-report-${role}.png`),fullPage:true});
      assert.deepEqual(errors,[]);await context.close();
      console.log(`${role}: live mobile tasks, More, monthly report, no horizontal overflow or JS errors`);
    }
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
