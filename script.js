// ============================================================
// 模型默认映射
// ============================================================
const MODEL_DEFAULTS = { deepseek: 'deepseek-chat', gpt: 'gpt-4.1-mini', gemini: 'gemini-2.0-flash', glm: 'glm-4-flash', qwen: 'qwen-turbo' };
const LANG_NAMES = {en:'English',zh:'Chinese',vi:'Vietnamese',es:'Spanish',pt:'Portuguese',ru:'Russian',ja:'Japanese',ko:'Korean',fr:'French',de:'German',ar:'Arabic',th:'Thai',id:'Indonesian'};

// ============================================================
// 中止控制
// ============================================================
var activeControllers = [];
var generationAborted = false;

function abortGeneration() {
    generationAborted = true;
    activeControllers.forEach(function(c) { try { c.abort(); } catch(e) {} });
    activeControllers = [];

    isGenerating = false;
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('generateBtn').textContent = '🚀 批量生成提示词';
    document.getElementById('abortBtn').style.display = 'none';
    document.getElementById('progressText').textContent = '⛔ 已中止（已完成 ' + document.querySelectorAll('#results-body tr').length + ' 条）';

    setTimeout(function() {
        document.getElementById('progress-area').style.display = 'none';
    }, 4000);
}

// ============================================================
// 工具函数
// ============================================================
function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'&#10;'); }
function escapeCsv(s) { return '"' + String(s).replace(/"/g,'""') + '"'; }
function charCount(s) { return [...s].length; }

// ============================================================
// 文案分割
// ============================================================
function splitScript(text) {
    var t = text.trim();
    if (!t) return ['',''];
    var isCn = /[\u4e00-\u9fff]/.test(t);
    var sents;
    if (isCn) sents = t.match(/[^。！？；\n]+[。！？；]?/g) || [t];
    else sents = t.match(/[^.!?\n]+[.!?]?/g) || [t];
    sents = sents.map(function(s){return s.trim()}).filter(function(s){return s.length>0});

    if (sents.length <= 1) {
        var total=t.length, mid=Math.floor(total/2), at=mid;
        for (var i=mid;i<total;i++) { if (/[\s，。、！？]/.test(t[i])) { at=i+1; break; } }
        if (at===mid) for (var i=mid;i>0;i--) { if (/[\s，。、！？]/.test(t[i])) { at=i+1; break; } }
        return [t.slice(0,at).trim(), t.slice(at).trim()];
    }
    if (sents.length === 2) return [sents[0], sents[1]];

    var totalCh=charCount(t), h1=[], h2=[], acc=0;
    for (var si=0;si<sents.length;si++) {
        var s=sents[si], c=charCount(s);
        if (acc+c<totalCh/2) { h1.push(s); acc+=c; } else { h2.push(s); }
    }
    if (!h1.length) return [h2.shift()||'', h2.join('')];
    if (!h2.length) { var l=h1.pop()||''; h2.push(l); }
    return [h1.join(''), h2.join('')];
}

// ============================================================
// UI 辅助
// ============================================================
function toggleKeyVisibility(cb) { document.getElementById('apiKey').type = cb.checked ? 'text' : 'password'; }

function toggleRefMode() {
    var show = document.getElementById('referenceImage').checked;
    document.getElementById('refOptions').style.display = show ? 'flex' : 'none';
    toggleRefSubMode();
}

function toggleRefSubMode() {
    var mode = document.querySelector('input[name="refMode"]:checked');
    var isMatch = mode && mode.value === 'match';
    document.querySelectorAll('#character-rows .brf-person').forEach(function(el) {
        el.classList.toggle('char-person-disabled', isMatch && document.getElementById('referenceImage').checked);
    });
    document.querySelectorAll('#character-rows .char-person').forEach(function(el) {
        el.disabled = isMatch && document.getElementById('referenceImage').checked;
    });
}

function showError(msg) {
    var t = document.getElementById('error-toast');
    t.innerHTML = msg; t.style.display = 'block';
    setTimeout(function(){t.style.display='none'}, 8000);
}

// ============================================================
// 人物行管理
// ============================================================
var charIdCounter = 0;

function addCharacterRow(label, person, scene) {
    charIdCounter++;
    var id = charIdCounter;
    var div = document.createElement('div');
    div.className = 'batch-row';
    div.id = 'char-row-'+id;
    div.innerHTML = '<div class="batch-row-fields">'
        +'<div class="brf-label"><label>标签</label><input type="text" class="char-label" value="'+(label||'人物'+id)+'" placeholder="例：人物A"></div>'
        +'<div class="brf-person"><label>人物特征</label><textarea class="char-person" rows="2" placeholder="例：年轻女性，瓜子脸……">'+escHtml(person||'')+'</textarea></div>'
        +'<div class="brf-scene"><label>场景动作</label><textarea class="char-scene" rows="2" placeholder="例：坐在明亮的客厅沙发上……">'+escHtml(scene||'')+'</textarea></div>'
        +'<button class="remove-btn" onclick="removeCharacterRow('+id+')" title="删除">✕</button>'
        +'</div>';
    document.getElementById('character-rows').appendChild(div);
    updateCharCount();
    toggleRefSubMode();
    return id;
}

function removeCharacterRow(id) { var r=document.getElementById('char-row-'+id); if(r){r.remove();updateCharCount();} }
function updateCharCount() { document.getElementById('charCount').textContent=document.querySelectorAll('#character-rows>.batch-row').length+' 组'; }

function getCharacterData() {
    var rows = [];
    document.querySelectorAll('#character-rows>.batch-row').forEach(function(row) {
        var personEl = row.querySelector('.char-person');
        rows.push({
            label: (row.querySelector('.char-label').value||'').trim()||'未命名',
            person: personEl.disabled ? '' : (personEl.value||'').trim(),
            scene: (row.querySelector('.char-scene').value||'').trim()
        });
    });
    return rows;
}

// ============================================================
// 文案行管理
// ============================================================
var scriptIdCounter = 0;

function addScriptRow(label, text) {
    scriptIdCounter++;
    var id = scriptIdCounter;
    var div = document.createElement('div');
    div.className = 'batch-row';
    div.id = 'script-row-'+id;
    div.innerHTML = '<div class="batch-row-fields">'
        +'<div class="brf-label"><label>标签</label><input type="text" class="script-label" value="'+(label||'文案'+id)+'" placeholder="例：文案A"></div>'
        +'<div class="brf-lang"><label>口播语言</label><select class="script-lang">'
        +'<option value="">原文（不翻译）</option>'
        +'<option value="en">English</option>'
        +'<option value="zh">中文</option>'
        +'<option value="vi">Tiếng Việt</option>'
        +'<option value="es">Español</option>'
        +'<option value="pt">Português</option>'
        +'<option value="ru">Русский</option>'
        +'<option value="ja">日本語</option>'
        +'<option value="ko">한국어</option>'
        +'<option value="fr">Français</option>'
        +'<option value="de">Deutsch</option>'
        +'<option value="ar">العربية</option>'
        +'<option value="th">ไทย</option>'
        +'<option value="id">Bahasa Indonesia</option>'
        +'</select></div>'
        +'<div class="brf-script"><label>文案内容</label><textarea class="script-text" rows="4" placeholder="粘贴口播文案 / 脚本……">'+escHtml(text||'')+'</textarea></div>'
        +'<button class="remove-btn" onclick="removeScriptRow('+id+')" title="删除">✕</button>'
        +'</div>';
    document.getElementById('script-rows').appendChild(div);
    updateScriptCount();
    return id;
}

function removeScriptRow(id) { var r=document.getElementById('script-row-'+id); if(r){r.remove();updateScriptCount();} }
function updateScriptCount() { document.getElementById('scriptCount').textContent=document.querySelectorAll('#script-rows>.batch-row').length+' 组'; }

function getScriptData() {
    var rows=[];
    document.querySelectorAll('#script-rows>.batch-row').forEach(function(row){
        rows.push({label:(row.querySelector('.script-label').value||'').trim()||'未命名', lang:(row.querySelector('.script-lang').value||''), text:(row.querySelector('.script-text').value||'').trim()});
    });
    return rows;
}

// ============================================================
// 构建 system prompt
// ============================================================
function buildSystemPrompt(charData, scriptText, sceneMood, style, message, cameraSpec, needRef, refMatch, seg, totalSeg, videoModel, targetLang) {
    var L = [];
    L.push('You are an expert AI video prompt writer. Write a detailed, professional prompt for AI video generation.');
    L.push(''); L.push('=== VIDEO MODEL ===');
    L.push('Target: ' + videoModel);
    if (totalSeg > 1) L.push('This is segment ' + seg + ' of ' + totalSeg + '.');
    L.push('');

    L.push('=== CHARACTER ===');
    if (needRef && refMatch) {
        L.push('Use the uploaded image as the fixed character identity reference. The character\'s facial features, face shape, eyes, nose, lips, proportions, skin tone, gender, age, and hair style must exactly match the reference image. Do NOT change, assume, or invent any physical features. The character\'s identity is 100% determined by the reference image. CRITICAL: Never change the gender shown in the reference image.');
        L.push('CRITICAL - GENDER: If the reference image shows a woman, the prompt MUST describe a woman. If it shows a man, it MUST describe a man. Never default to or switch to male. The gender from the reference is final.');
        L.push('No separate character description is needed - the character IS the reference image.');
    } else if (charData.person) {
        L.push('Character appearance: ' + charData.person);
        if (needRef) L.push('The character\'s appearance should be based on the reference image, but with the following modifications applied. The facial structure, gender, and core identity must still remain recognizable from the reference. Never change the gender from the reference image.');
    } else {
        L.push('Character appearance is defined by the reference image. Maintain visual consistency throughout.');
    }
    L.push('Scene and setting: ' + (charData.scene || '(not specified)'));
    L.push('');

    L.push('=== DIALOGUE ===');
    L.push('The character speaks the following dialogue in this segment:');
    if (targetLang) {
        L.push('The character speaks in: ' + targetLang + '.');
        L.push('CRITICAL - TRANSLATION REQUIRED: Translate the dialogue below into ' + targetLang + '.');
        L.push('Include ONLY the ' + targetLang + ' version in your prompt. Do NOT include the original text.');
        L.push('The translation must sound natural and conversational in ' + targetLang + '.');
        L.push('Original text to translate: "' + scriptText + '"');
    } else {
        L.push('"' + scriptText + '"');
        L.push('CRITICAL - WORD FOR WORD: Include the ENTIRE dialogue text above EXACTLY as written.');
        L.push('Do NOT summarize, paraphrase, truncate, or modify it. Copy it character-for-character into your prompt.');
    }
    L.push('');

    L.push('=== CREATIVE DIRECTION ===');
    if (sceneMood) L.push('Scene atmosphere and mood: ' + sceneMood);
    if (style) L.push('Desired style and tone: ' + style);
    if (message) L.push('Key message to convey: ' + message);
    if (!sceneMood && !style && !message) L.push('(No specific creative direction provided - use natural, engaging defaults.)');
    L.push('');

    L.push('=== CAMERA SPECS ===');
    if (cameraSpec) L.push('Camera instructions: ' + cameraSpec);
    L.push('');

    L.push('=== VIDEO MODEL REQUIREMENTS ===');
    if (videoModel === 'Veo') {
        if (totalSeg > 1 && seg === 1) {
            L.push('- OPENING/ESTABLISHING segment. Establish character, scene, lighting, and camera position.');
            L.push('- Include the exact dialogue naturally.');
            L.push('- End cleanly for a cut to segment 2.');
        } else if (totalSeg > 1 && seg === 2) {
            L.push('- CONTINUATION segment. Follows directly from segment 1.');
            L.push('- Character and scene already established; maintain visual consistency.');
            L.push('- Use "Continuation of the previous scene" phrasing.');
            L.push('- Include the exact dialogue as a continuation.');
        }
        L.push('- Framing: Medium close-up (chest to head), camera slightly below eye level (boyfriend/selfie perspective).');
        L.push('- Style: Clean natural daylight, realistic skin texture, cinematic smartphone-style, vibrant colors, 4K.');
    } else {
        L.push('- Single continuous take. Deliver the full script in one scene.');
        L.push('- Framing: Medium close-up, subtle front-camera perspective.');
        L.push('- Style: Clean natural daylight, realistic skin texture, smooth camera movement, vibrant colors, 4K.');
    }
    L.push('');

    L.push('=== OUTPUT RULES ===');
    L.push('1. Write ONLY in English.');
    L.push('2. Describe the character appearance at the start. If reference image is used, state it prominently.');
    if (!targetLang) L.push('3. CRITICAL: Include the ENTIRE dialogue EXACTLY as provided above. Do not shorten it.');
    if (targetLang) L.push('3. CRITICAL: Include the translated version of the dialogue. The character speaks in ' + targetLang + ' - the dialogue in the prompt MUST be in ' + targetLang + ', not the original language. The translation must be natural and conversational.');
    L.push('4. Describe camera positioning, framing, lighting, and environment.');
    L.push('5. Match the desired style and scene atmosphere.');
    L.push('6. Output ONLY the prompt text. No explanations, no labels, no markdown, no surrounding quotes.');

    return L.join('\n');
}

// ============================================================
// 调用后端 API（支持中止）
// ============================================================
function callAI(actualModel, apiKey, systemPrompt, userPrompt, baseUrl, variation, signal) {
    var userMsg = userPrompt;
    if (variation > 0) {
        userMsg += ' (Variation ' + (variation + 1) + ': use slightly different wording and framing.)';
    }
    return fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: actualModel,
            apiKey: apiKey,
            baseUrl: baseUrl,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }]
        }),
        signal: signal
    }).then(function(resp) {
        return resp.json().then(function(data) {
            if (!resp.ok) throw new Error(data.error || 'HTTP '+resp.status);
            if (data.error) throw new Error(data.error);
            return data.text;
        });
    });
}

// ============================================================
// 批量生成
// ============================================================
var isGenerating = false;
var renderedCount = 0;
var pendingErrors = [];

function batchGenerate() {
    if (isGenerating) return;

    // ---- 验证 ----
    var aiModel = document.getElementById('aiModel').value;
    var apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) { showError('请填写 API Key'); return; }

    var vmRadio = document.querySelector('input[name="videoModel"]:checked');
    if (!vmRadio) { showError('请选择目标视频模型'); return; }
    var isVeo = vmRadio.value === 'veo';
    var videoModelName = isVeo ? 'Veo' : '即梦';

    var characters = getCharacterData();
    var scripts = getScriptData();
    if (characters.length === 0) { showError('请至少添加一组人物'); return; }
    if (scripts.length === 0) { showError('请至少添加一条文案'); return; }
    for (var ci=0;ci<characters.length;ci++) {
        var c=characters[ci];
        if (!c.scene) { showError('人物「'+c.label+'」场景为空'); return; }
    }
    for (var si=0;si<scripts.length;si++) {
        if (!scripts[si].text) { showError('文案「'+scripts[si].label+'」内容为空'); return; }
    }

    var sceneMood = document.getElementById('sceneMood').value.trim();
    var style = document.getElementById('styleTone').value.trim();
    var message = document.getElementById('keyMessage').value.trim();
    var cameraSpec = document.getElementById('cameraSpec').value.trim();
    var needRef = document.getElementById('referenceImage').checked;
    var refMode = needRef ? (document.querySelector('input[name="refMode"]:checked') || {}).value : null;
    var refMatch = refMode === 'match';

    var baseUrl = document.getElementById('customBaseUrl').value.trim();
    var customModel = document.getElementById('customModel').value.trim();
    var actualModel = customModel || MODEL_DEFAULTS[aiModel] || aiModel;

    var outputCount = parseInt(document.getElementById('outputCount').value, 10) || 1;
    if (outputCount < 1) outputCount = 1;
    if (outputCount > 10) outputCount = 10;

    // ---- 构建组合队列 ----
    var combos = [];
    var seqCounter = 0;

    for (var ci2=0;ci2<characters.length;ci2++) {
        var ch = characters[ci2];
        for (var si2=0;si2<scripts.length;si2++) {
            var sc = scripts[si2];
            if (isVeo) {
                var parts = splitScript(sc.text);
                var segs = [];
                if (parts[0]) segs.push({ seg:1, tot:2, text:parts[0], segLabel:'1/2' });
                if (parts[1]) segs.push({ seg:2, tot:2, text:parts[1], segLabel:'2/2' });
                for (var vi=0;vi<outputCount;vi++) {
                    var tasks = segs.map(function(s) {
                        return {
                            seq: ++seqCounter,
                            charLabel: ch.label,
                            scriptLabel: sc.label,
                            modelName: 'Veo',
                            seg: s.segLabel,
                            variant: outputCount > 1 ? (vi+1) : 0,
                            charData: ch,
                            scriptText: s.text,
                            segment: s.seg,
                            totalSegments: s.tot,
                            videoModel: 'Veo',
                            lang: sc.lang
                        };
                    });
                    combos.push({ tasks: tasks, variation: vi });
                }
            } else {
                for (var vi2=0;vi2<outputCount;vi2++) {
                    combos.push({
                        tasks: [{
                            seq: ++seqCounter,
                            charLabel: ch.label,
                            scriptLabel: sc.label,
                            modelName: '即梦',
                            seg: '',
                            variant: outputCount > 1 ? (vi2+1) : 0,
                            charData: ch,
                            scriptText: sc.text,
                            segment: 1,
                            totalSegments: 1,
                            videoModel: '即梦',
                            lang: sc.lang
                        }],
                        variation: vi2
                    });
                }
            }
        }
    }

    // ---- 重置状态 ----
    isGenerating = true;
    generationAborted = false;
    pendingErrors = [];
    renderedCount = 0;
    activeControllers = [];

    document.getElementById('generateBtn').disabled = true;
    document.getElementById('generateBtn').textContent = '⏳ AI 生成中...';
    document.getElementById('result-area').style.display = 'none';
    document.getElementById('results-body').innerHTML = '';
    document.getElementById('progress-area').style.display = 'block';
    document.getElementById('abortBtn').style.display = 'inline-block';

    var totalTasks = combos.reduce(function(sum,c){return sum+c.tasks.length;}, 0);
    updateProgress(0, totalTasks);
    document.getElementById('progressText').textContent = '正在调用 ' + aiModel + ' → ' + actualModel + ' ...';

    var results = [];
    var completed = 0;
    var active = 0;
    var CONCURRENCY = 3;

    function tick() {
        if (generationAborted) return;
        while (combos.length > 0 && active < CONCURRENCY && !generationAborted) {
            var combo = combos.shift();
            active++;
            processCombo(combo);
        }
        if (active === 0 && combos.length === 0 && !generationAborted) {
            finishBatch();
        }
    }

    function processCombo(combo) {
        var p = Promise.resolve();
        combo.tasks.forEach(function(task) {
            p = p.then(function() {
                if (generationAborted) return;
                var sp = buildSystemPrompt(
                    task.charData, task.scriptText,
                    sceneMood, style, message, cameraSpec,
                    needRef, refMatch, task.segment, task.totalSegments, task.videoModel,
                    LANG_NAMES[task.lang] || ''
                );
                var up = 'Write the ' + task.videoModel + ' video prompt for segment ' + task.segment + ' of ' + task.totalSegments + '.';

                // Create abort controller for this request
                var controller = new AbortController();
                activeControllers.push(controller);

                return callAI(actualModel, apiKey, sp, up, baseUrl, combo.variation, controller.signal)
                    .then(function(text) {
                        // Remove from active controllers
                        var idx = activeControllers.indexOf(controller);
                        if (idx !== -1) activeControllers.splice(idx, 1);

                        if (!generationAborted) {
                            results.push({
                                seq: task.seq,
                                cl: task.charLabel,
                                sl: task.scriptLabel,
                                m: task.modelName,
                                seg: task.seg,
                                var: task.variant,
                                pt: text.trim()
                            });
                        }
                    })
                    .catch(function(e) {
                        // Remove from active controllers
                        var idx = activeControllers.indexOf(controller);
                        if (idx !== -1) activeControllers.splice(idx, 1);

                        // Don't report errors for aborted requests
                        if (generationAborted) return;
                        if (e.name === 'AbortError') return;

                        pendingErrors.push(task.charLabel+' × '+task.scriptLabel+' ['+task.modelName+' '+task.seg+']: '+e.message);
                    });
            }).then(function() {
                if (generationAborted) return;
                completed++;
                updateProgress(completed, totalTasks);
                renderResults(results);
            });
        });
        p.finally(function() {
            active--;
            if (!generationAborted) tick();
        });
    }

    tick();
}

// ============================================================
// 进度 & 结果渲染
// ============================================================
function updateProgress(done, total) {
    var pct = total > 0 ? Math.min(100, Math.round(done/total*100)) : 0;
    document.getElementById('progressFill').style.width = pct+'%';
    document.getElementById('progressText').textContent = done+' / '+total+' 条完成 ('+pct+'%)';
}

function renderResults(results) {
    var tbody = document.getElementById('results-body');
    while (renderedCount < results.length) {
        var r = results[renderedCount];
        renderedCount++;
        var mc = r.m === 'Veo' ? 'model-veo' : 'model-jimeng';
        var varCell = r.var > 0 ? '#'+r.var : '';
        var tr = document.createElement('tr');
        tr.innerHTML = '<td class="col-num">'+r.seq+'</td>'
            +'<td class="col-char">'+escHtml(r.cl)+'</td>'
            +'<td class="col-script">'+escHtml(r.sl)+'</td>'
            +'<td class="col-model"><span class="model-badge '+mc+'">'+r.m+'</span></td>'
            +'<td class="col-seg">'+r.seg+'</td>'
            +'<td class="col-var">'+varCell+'</td>'
            +'<td class="col-prompt"><pre class="prompt-preview">'+escHtml(r.pt)+'</pre></td>'
            +'<td class="col-copy"><button class="copy-btn-small" onclick="copyResult(this)" data-prompt="'+escAttr(r.pt)+'">复制</button></td>';
        tbody.appendChild(tr);
    }
}

function finishBatch() {
    if (generationAborted) return;
    isGenerating = false;
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('generateBtn').textContent = '🚀 批量生成提示词';
    document.getElementById('abortBtn').style.display = 'none';

    var totalRows = document.querySelectorAll('#results-body tr').length;
    if (totalRows > 0) {
        document.getElementById('resultCount').textContent = totalRows+' 条提示词';
        document.getElementById('result-area').style.display = 'block';
        document.getElementById('progressText').textContent = '✅ 全部完成！共 '+totalRows+' 条';
        setTimeout(function(){document.getElementById('progress-area').style.display='none';}, 3000);
    } else {
        document.getElementById('progressText').textContent = '❌ 未生成任何结果';
    }
    if (pendingErrors.length > 0) {
        var msgs = pendingErrors.slice(0,5).join('<br>');
        showError('部分任务失败:<br>'+msgs+(pendingErrors.length>5?'<br>... 还有 '+(pendingErrors.length-5)+' 条':''));
    }
}

// ============================================================
// 复制
// ============================================================
function copyResult(btn) {
    var text = btn.getAttribute('data-prompt');
    navigator.clipboard.writeText(text).then(function(){
        var o=btn.textContent; btn.textContent='✓ 已复制';
        setTimeout(function(){btn.textContent=o;},1500);
    }).catch(function(){alert('复制失败');});
}

function copyAllResults() {
    var rows = document.querySelectorAll('#results-body tr');
    var text = '';
    rows.forEach(function(tr){
        var n=tr.querySelector('.col-num').textContent;
        var m=tr.querySelector('.col-model').textContent.trim();
        var sg=tr.querySelector('.col-seg').textContent.trim();
        var v=tr.querySelector('.col-var').textContent.trim();
        var p=tr.querySelector('.prompt-preview').textContent;
        if (p) text += '=== ['+n+'] '+m+' '+sg+(v?' var'+v:'')+' ===\n'+p+'\n\n';
    });
    navigator.clipboard.writeText(text).then(function(){alert('已复制全部 '+rows.length+' 条提示词！');}).catch(function(){alert('复制失败');});
}

// ============================================================
// 导出 CSV
// ============================================================
function exportCSV() {
    var rows = document.querySelectorAll('#results-body tr');
    var csv = '\uFEFF';
    csv += '"#","角色","文案","模型","分段","变体","提示词"\n';
    rows.forEach(function(tr){
        csv += escapeCsv(tr.querySelector('.col-num').textContent)+','
            +escapeCsv(tr.querySelector('.col-char').textContent)+','
            +escapeCsv(tr.querySelector('.col-script').textContent)+','
            +escapeCsv(tr.querySelector('.col-model').textContent.trim())+','
            +escapeCsv(tr.querySelector('.col-seg').textContent.trim())+','
            +escapeCsv(tr.querySelector('.col-var').textContent.trim())+','
            +escapeCsv(tr.querySelector('.prompt-preview').textContent)+'\n';
    });
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '视频提示词_AI生成.csv';
    link.click();
    URL.revokeObjectURL(link.href);
}

// ============================================================
// 初始化
// ============================================================
window.onload = function() {
    addCharacterRow('人物A', '年轻女性，瓜子脸，大眼睛，黑长直发，苗条身材，穿着白色连衣裙', '坐在明亮的现代客厅沙发上，自然日光，中景镜头，手机视角');
    addScriptRow('文案A', `好友几百个，聊得来的没几个。
不查户口、不尬聊，用兴趣匹配懂你的人。
社恐友好，只走心不走肾。
别让孤独陪你过夜，点左下角，今晚就有人懂你。`);
};
