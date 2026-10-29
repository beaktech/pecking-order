import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Store } from '../src/store.js'
import { createAppServer } from '../src/server.js'
import { exportSelections } from '../src/export.js'
import { defaultsKey, stationDefaults, validateStationDefaults, recordingMetadata, preparationChecks } from '../src/preparation.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-preparation-'))
  t.after(() => rm(root, { recursive:true, force:true }))
  const config = { source:'birdnet-go', archiveRoot:join(root,'archive'), sourceTimezone:'UTC', timezone:'Europe/London', dataRoot:join(root,'data'), exportRoot:join(root,'exports'), country:'United Kingdom' }
  const store = await new Store(config.dataRoot).load()
  const clips = ['kept','rejected','unreviewed'].map(id => ({id,slug:'parus_major',scientificName:'Parus major',commonName:'Great Tit',timestamp:'2026-05-15T10:09:00Z',relPath:`${id}.wav`,path:join(root,`${id}.wav`),confidence:98}))
  store.updateReview('kept',{decision:'keep',confirmed:true,vocalisationType:'call'})
  store.updateReview('rejected',{decision:'reject'})
  const library = { clips, get:id=>clips.find(clip=>clip.id===id), station:()=>({name:'Garden',latitude:51,longitude:-1,device:'Original recorder'}), summary:()=>({}) }
  return {root,config,store,clips,library}
}

test('upload defaults persist per source archive alongside reviews and measurements', async t => {
  const {config,library,store} = await fixture(t)
  store.uploadDefaults[defaultsKey(config)] = validateStationDefaults({country:'France',location:'Pond',latitude:0,longitude:0,device:'Saved recorder'})
  store.metrics.kept = {score:91}
  await store.save()
  const reloaded = await new Store(config.dataRoot).load()
  const defaults = stationDefaults(config,library,reloaded)
  assert.equal(defaults.country,'France')
  assert.equal(defaults.latitude,0)
  assert.equal(defaults.device,'Saved recorder')
  assert.equal(reloaded.reviews.kept.confirmed,true)
  assert.equal(reloaded.metrics.kept.score,91)
  assert.equal(stationDefaults({...config,archiveRoot:join(config.archiveRoot,'other')},library,reloaded).device,'Original recorder')
})

test('defaults accept blanks and zero coordinates but reject invalid values without leaking extra fields', () => {
  const clean = validateStationDefaults({latitude:'0',longitude:'-0',elevation:'-12',country:' UK ',archiveRoot:'/other'})
  assert.equal(clean.country,'UK')
  assert.equal(clean.latitude,0)
  assert.equal(clean.elevation,-12)
  assert.equal(clean.archiveRoot,undefined)
  assert.equal(validateStationDefaults({latitude:' '}).latitude,'')
  for (const input of [{latitude:91},{longitude:'Infinity'},{longitude:-181},{elevation:'sea level'},{device:{}},null]) {
    assert.throws(()=>validateStationDefaults(input),error=>error.statusCode===400)
  }
})

test('metadata shares defaults with exports, preserves individual overrides and never guesses song', async t => {
  const {config,store,library,clips} = await fixture(t)
  const defaults = stationDefaults(config,library,store)
  const metadata = recordingMetadata(clips[0],{location:'Different site',latitude:0,device:'',remarks:'Individual note'},defaults,config)
  assert.equal(metadata.location,'Different site')
  assert.equal(metadata.latitude,0)
  assert.equal(metadata.device,'Original recorder')
  assert.equal(metadata.remarks,'Individual note')
  assert.equal(metadata.type,'')
  assert.equal(metadata.time,'11:09')
  assert.ok(preparationChecks(metadata,{}).some(check=>check.includes('sound type')))
  assert.ok(preparationChecks(metadata,{}).some(check=>check.includes('confirm')))
  assert.deepEqual(preparationChecks({...metadata,type:'call'},{confirmed:true}),[])
  assert.ok(preparationChecks({...metadata,longitude:200},{confirmed:true}).some(check=>check.includes('longitude')))
})

test('preparation API saves station details, reports only kept clips, and rolls back failed writes', async t => {
  const {config,store,library} = await fixture(t)
  const server = createAppServer({config,store,getLibrary:()=>library})
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const base=`http://127.0.0.1:${server.address().port}`
  const put=details=>fetch(`${base}/api/preparation/defaults`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(details)})
  const saved={country:'United Kingdom',location:'Test garden',latitude:0,longitude:0,device:'New recorder'}
  assert.equal((await put(saved)).status,200)
  const data=await (await fetch(`${base}/api/preparation`)).json()
  assert.equal(data.clips.length,1)
  assert.equal(data.clips[0].id,'kept')
  assert.equal(data.clips[0].defaults.device,'New recorder')
  assert.equal(data.clips[0].metadata.device,'New recorder')
  assert.deepEqual(data.clips[0].checks,[])
  assert.equal((await put({latitude:'bad'})).status,400)
  const previous=store.uploadDefaults[defaultsKey(config)]
  const save=store.save.bind(store)
  store.save=async()=>{throw new Error('Synthetic disk failure')}
  assert.equal((await put({...saved,device:'Must not persist'})).status,500)
  assert.deepEqual(store.uploadDefaults[defaultsKey(config)],previous)
  store.save=save
  assert.equal((await new Store(config.dataRoot).load()).uploadDefaults[defaultsKey(config)].device,'New recorder')
})

test('WAV export uses saved defaults and per-clip overrides, including countries and zero coordinates', async t => {
  const {config,store,library,clips} = await fixture(t)
  await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=1000:duration=0.05',clips[0].path])
  store.uploadDefaults[defaultsKey(config)] = validateStationDefaults({country:'France',location:'Pond',latitude:0,longitude:0,device:'Default recorder',remarks:'Default remarks'})
  store.updateReview('kept',{country:'United Kingdom',microphone:'Clip microphone'})
  const result=await exportSelections({ids:['kept'],library,store,config})
  const csv=await readFile(join(result.outputDir,'xeno-canto-metadata.csv'),'utf8')
  assert.match(csv,/"United Kingdom","Pond","0","0"/)
  assert.match(csv,/"Default recorder","Clip microphone","Default remarks"/)
  assert.match(csv,/"call"/)
  assert.match(await readFile(join(result.outputDir,'README.txt'),'utf8'),/not an automated upload or a verified/)
})
