import re,sys
src=open(sys.argv[1]).read()
m=src[src.index('<div style="width: 1600px'):src.index('</x-dc>')]
def rep(old,new,count=1):
    global m
    assert old in m, old[:80]
    m=m.replace(old,new,count)
# --- live-data edits ---
# drop our status strip (BYD's header shows time + outside temp) and its grid row
def opt(old,new):
    global m
    m=m.replace(old,new,1)
if '  <!-- STATUS STRIP -->' in m:
    i=m.index('  <!-- STATUS STRIP -->'); j=m.index('  <!-- RANGE (large) -->'); m=m[:i]+m[j:]
opt('width: 1600px; height: 900px; box-sizing: border-box; padding: 24px 28px 28px;','width: 1600px; height: 838px; box-sizing: border-box; padding: 20px 28px 28px;')
opt('grid-template-rows: 44px minmax(0, 1fr) 184px;','grid-template-rows: minmax(0, 1fr) 184px;')
opt('<span style="font-size: 12px; color: #A6A6A6; border: 1px solid #333; border-radius: 4px; padding: 2px 8px;">SAMPLE DATA</span>',
    '<span style="font-size: 12px; color: {{liveColor}}; border: 1px solid #333; border-radius: 4px; padding: 2px 8px;">{{liveLabel}}</span>')
rep('<span style="color: #4A4A4A;">P</span><span style="color: #4A4A4A;">R</span><span style="color: #4A4A4A;">N</span><span style="color: {{accent}};">D</span>',
    '<span style="color: {{gearP}};">P</span><span style="color: {{gearR}};">R</span><span style="color: {{gearN}};">N</span><span style="color: {{gearD}};">D</span>')
opt('<button type="button" onClick="{{cycleMode}}" aria-label="Energy flow: {{modeLabel}}. Tap to preview the next mode" style="background: #111111;',
    '<button type="button" onClick="{{openEnergy}}" aria-label="Energy: {{modeLabel}}" style="background: #111111;')
opt('kPa · all OK','{{tyreNote}}')
opt('{{evShare}}% electric','{{tripFuel}}')
opt('<div style="height: 4px; background: #262626;"><div style="height: 4px; width: {{evShare}}%; background: {{accent}};"></div></div>',
    '<div style="font-size: 13px; color: #A6A6A6;">ODO {{odo}} km</div>')
rep('<a href="#" aria-label="Open CarPlay"','<a href="#" onClick="{{openCarPlay}}" aria-label="Open CarPlay"')
# now playing
rep('''<div style="flex: 1; min-height: 0; background: #1E1E1E; border-radius: 6px; display: flex; align-items: center; justify-content: center;">''',
    '''<div style="flex: 1; min-height: 0; background: #1E1E1E center / contain no-repeat; background-image: {{artBg}}; border-radius: 6px; display: flex; align-items: center; justify-content: center;">''')
rep('<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#4A4A4A"','<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="{{noteColor}}"')
rep('TRACK TITLE</div>','{{trackTitle}}</div>')
rep('>Artist · Spotify</div>','>{{trackSub}}</div>')
rep('font-size: 30px;">{{trackTitle}}','font-size: 30px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{trackTitle}}')
rep('<span>1:24</span><span>3:41</span>','<span>{{posText}}</span><span>{{durText}}</span>')
rep('<button type="button" aria-label="Previous track"','<button type="button" onClick="{{prevTrack}}" aria-label="Previous track"')
rep('<button type="button" aria-label="Next track"','<button type="button" onClick="{{nextTrack}}" aria-label="Next track"')
# Fill the screen width: the page is 838 px tall and as wide as the screen's shape allows.
rep('width: 1600px; height: 838px; box-sizing: border-box;','width: 100%; height: 838px; box-sizing: border-box;')
rep('grid-template-columns: 340px 400px 400px minmax(0, 1fr);','grid-template-columns: minmax(0, 0.97fr) minmax(0, 1.14fr) minmax(0, 1.14fr) minmax(0, 1fr);')
m=m.replace('width: 1600px; height: 838px; z-index: 10;','width: 100%; height: 838px; z-index: 10;')
m=m.replace('top: 0; left: 0; width: 1600px; height: 838px; background:','top: 0; left: 0; width: 100%; height: 838px; background:')
m=m.replace('left: 440px; top: 250px; width: 720px;','left: 50%; margin-left: -360px; top: 250px; width: 720px;')
# --- template conversion to htm ---
m=re.sub(r'<!--.*?-->','',m,flags=re.S)
m=re.sub(r'\s+hint-placeholder-[a-z]+="[^"]*"','',m)
def conv_for(mm):
    lst,var,inner=mm.group(1),mm.group(2),mm.group(3)
    inner=re.sub(r'\{\{'+var+r'\.',  '{{@'+var+'.',inner)
    return '${v.'+lst+'.map(('+var+') => html`'+inner+'`)}'
m=re.sub(r'<sc-for list="\{\{([\w.]+)\}\}" as="(\w+)">(.*?)</sc-for>',conv_for,m,flags=re.S)
def conv_if(mm):
    return '${v.'+mm.group(1)+' ? html`'+mm.group(2)+'` : null}'
# innermost first, so nested sc-if blocks pair up correctly
while '<sc-if' in m:
    m=re.sub(r'<sc-if value="\{\{([\w.]+)\}\}">((?:(?!<sc-if).)*?)</sc-if>',conv_if,m,flags=re.S)
# single-binding attributes pass raw values
m=re.sub(r'(\w[\w-]*)="\{\{(@?)([\w.]+)\}\}"',lambda x: x.group(1)+'=${'+('' if x.group(2) else 'v.')+x.group(3)+'}',m)
m=re.sub(r'\{\{(@?)([\w.]+)\}\}',lambda x:'${'+('' if x.group(1) else 'v.')+x.group(2)+'}',m)
m=m.replace('onChange=${v.onSlide}','onInput=${v.onSlide}')
# htm needs void elements self-closed, or it swallows what follows (the stray "div").
m=re.sub(r'<(input|img|br|hr)\b([^>]*?)\s*/?>',r'<\1\2 />',m)
assert '{{' not in m and 'sc-' not in m, re.findall(r'.{40}(?:\{\{|sc-).{40}',m)[:5]
open(sys.argv[2],'w').write(m)
print(len(m))

# --- old WebView compatibility (car's Chromium has no flexbox gap and no `inset`) ---
m=open(sys.argv[2]).read()
m=m.replace('inset: 0;','top: 0; right: 0; bottom: 0; left: 0;')
gaps=set()
def fixstyle(mm):
    st=mm.group(1)
    if 'display: flex' not in st: return mm.group(0)
    g=re.search(r'(?:^|; ?)gap: (\d+)px;?',st)
    if not g: return mm.group(0)
    n=g.group(1)
    col='flex-direction: column' in st
    st2=re.sub(r'(^|; ?)gap: \d+px;?',r'\1',st).strip()
    cls=('gy-' if col else 'gx-')+n
    gaps.add(cls)
    return 'class="'+cls+'" style="'+st2+'"'
m=re.sub(r'style="([^"]*)"',fixstyle,m)
assert 'inset' not in m
open(sys.argv[2],'w').write(m)
css=''.join(('.%s>*+*{margin-%s:%spx}'%(c,'top' if c.startswith('gy') else 'left',c[3:])) for c in sorted(gaps))
open(sys.argv[2]+'.css','w').write(css)
print(css)
