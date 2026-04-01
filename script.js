document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('search-input');
    const navItems = document.querySelectorAll('.nav-item');
    const tabPills = document.querySelectorAll('.tab-pill');
    const sendBtn = document.getElementById('send-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');
    const modelSelectBtn = document.getElementById('model-select-btn');
    const modelDropdown = document.getElementById('model-dropdown');
    const modelOptions = document.querySelectorAll('.model-option');
    const currentModelName = document.getElementById('current-model-name');
    const themeToggle = document.getElementById('theme-toggle');
    const toggleIcon = document.getElementById('toggle-icon');
    
    const chatThread = document.getElementById('chat-thread');
    const suggestionsSection = document.getElementById('suggestions-section');
    const recentThreadsList = document.getElementById('recent-threads-list');
    const heroSection = document.querySelector('.hero');
    
    // PDF Upload Elements
    const attachBtn = document.getElementById('attach-btn');
    const fileUploadInput = document.getElementById('file-upload');
    const fileChipContainer = document.getElementById('file-chip-container');
    const attachedFilename = document.getElementById('attached-filename');
    const removeFileBtn = document.getElementById('remove-file-btn');

    let currentThreadId = null;
    let selectedModel = 'gemini-2.5-flash';
    let isSending = false;

    const appendMessage = (role, text, sources) => {
        const isUser = role === 'user';
        const iconName = isUser ? 'user' : 'sparkles';
        const headerText = isUser ? 'You' : 'Answer';
        
        let innerContent = isUser ? `<p>${escapeHtml(text)}</p>` : (window.marked ? marked.parse(text) : `<p>${text}</p>`);

        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isUser ? 'user' : 'model'}`;
        
        let sourcesHtml = '';
        if (sources && sources.length > 0) {
            sourcesHtml = `
                <div class="message-sources">
                    <div class="sources-header"><i data-lucide="layers"></i><span>Sources</span></div>
                    <div class="sources-list">
                        ${sources.map((s, idx) => `
                            <a href="${s.url}" target="_blank" class="source-item">
                                <span class="source-idx">${idx + 1}</span>
                                <span class="source-title">${s.title}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        msgDiv.innerHTML = `
            <div class="message-header ${isUser ? 'user-header' : ''}">
                <i data-lucide="${iconName}"></i>
                <span>${headerText}</span>
            </div>
            ${sourcesHtml}
            <div class="message-content">
                ${innerContent}
            </div>
        `;
        
        // Add copy buttons to pre blocks
        if (!isUser) {
            const preBlocks = msgDiv.querySelectorAll('pre');
            preBlocks.forEach(pre => {
                const button = document.createElement('button');
                button.className = 'copy-btn';
                button.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
                pre.appendChild(button);
                
                button.addEventListener('click', () => {
                    const codeEl = pre.querySelector('code');
                    const code = codeEl ? codeEl.innerText : pre.innerText;
                    navigator.clipboard.writeText(code).then(() => {
                        button.innerHTML = '<i data-lucide="check"></i><span>Copied!</span>';
                        setTimeout(() => {
                            button.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
                            if (window.lucide) lucide.createIcons();
                        }, 2000);
                        if (window.lucide) lucide.createIcons();
                    }).catch(() => {
                        // Fallback for older browsers
                        const textarea = document.createElement('textarea');
                        textarea.value = code;
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        button.innerHTML = '<i data-lucide="check"></i><span>Copied!</span>';
                        setTimeout(() => {
                            button.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
                            if (window.lucide) lucide.createIcons();
                        }, 2000);
                    });
                });
            });
        }

        chatThread.appendChild(msgDiv);

        if (window.lucide) {
            lucide.createIcons();
        }
        
        // Use a smoother scroll
        setTimeout(() => {
            msgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    };

    // Simple HTML escaper for user text
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const appendLoader = () => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message loader-msg`;
        msgDiv.innerHTML = `
            <div class="message-header">
                <i data-lucide="sparkles"></i>
                <span>Answer</span>
            </div>
            <div class="message-content">
                <div class="loading-skeleton">
                    <span class="loader"></span>
                    <span>Thinking...</span>
                </div>
            </div>
        `;
        chatThread.appendChild(msgDiv);
        if (window.lucide) lucide.createIcons();
        chatThread.lastElementChild.scrollIntoView({ behavior: 'smooth' });
        return msgDiv;
    };

    const renderSidebar = (threads, currentId) => {
        recentThreadsList.innerHTML = '';
        if (!threads || threads.length === 0) {
            recentThreadsList.innerHTML = `<p class="recent-empty">Recent and active threads will appear here.</p>`;
            return;
        }

        threads.forEach(thread => {
            const a = document.createElement('a');
            a.className = `recent-thread ${thread.id === currentId ? 'active' : ''}`;
            a.innerHTML = `<i data-lucide="message-square"></i><span>${thread.title}</span>`;
            
            a.addEventListener('click', (e) => {
                e.preventDefault();
                loadThread(thread.id);
            });
            recentThreadsList.appendChild(a);
        });
        
        if (window.lucide) lucide.createIcons();
    };

    const refreshSidebar = async () => {
        try {
            const res = await fetch('/api/history');
            if (res.ok) {
                const data = await res.json();
                renderSidebar(data.threads, currentThreadId);
            }
        } catch (err) {
            console.error("Failed to refresh sidebar:", err);
        }
    };

    const loadThread = async (threadId) => {
        try {
            const res = await fetch(`/api/history?thread_id=${threadId}`);
            if (res.ok) {
                const data = await res.json();
                currentThreadId = data.current_thread;
                
                // Clear UI
                chatThread.innerHTML = '';
                
                if (data.history && data.history.length > 0) {
                    if (heroSection) heroSection.style.display = 'none';
                    suggestionsSection.style.display = 'none';
                    chatThread.style.display = 'flex';
                    data.history.forEach(msg => appendMessage(msg.role, msg.text));
                } else {
                    if (heroSection) heroSection.style.display = '';
                    suggestionsSection.style.display = 'block';
                    chatThread.style.display = 'none';
                }

                renderSidebar(data.threads, currentThreadId);
            }
        } catch (err) {
            console.error("Failed to load thread:", err);
        }
    };

    // --- On Load: Fetch Global State ---
    const initializeApp = async () => {
        // Enforce Local Server usage
        if (window.location.protocol === 'file:') {
            const warningEl = document.getElementById('protocol-warning');
            if (warningEl) warningEl.style.display = 'flex';
            if (window.lucide) lucide.createIcons();
            return; // Stop initialization
        }

        try {
            const histResponse = await fetch('/api/history');
            if (histResponse.ok) {
                const data = await histResponse.json();
                renderSidebar(data.threads, currentThreadId);
                
                // If there's at least one thread, set it as current but keep welcome screen
                if (data.threads && data.threads.length > 0) {
                    currentThreadId = data.threads[0].id;
                }
            }
        } catch (err) {
            console.log("Backend offline or inaccessible:", err);
        }
    };
    initializeApp();

    // --- PDF Upload Logic ---
    if (attachBtn && fileUploadInput) {
        attachBtn.addEventListener('click', () => fileUploadInput.click());
        
        fileUploadInput.addEventListener('change', async () => {
            const file = fileUploadInput.files[0];
            if (!file) return;

            // Ensure we have a thread before uploading
            if (!currentThreadId) {
                try {
                    const res = await fetch('/api/new_chat', { method: 'POST' });
                    if (res.ok) {
                        const data = await res.json();
                        currentThreadId = data.thread_id;
                        await refreshSidebar();
                    }
                } catch (err) {
                    console.error("Failed to auto-create thread for upload", err);
                    return;
                }
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('thread_id', currentThreadId);

            try {
                attachBtn.classList.add('loading');
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                if (response.ok) {
                    attachedFilename.textContent = data.filename;
                    fileChipContainer.style.display = 'block';
                    if (window.lucide) lucide.createIcons();
                } else {
                    alert(`Upload Error: ${data.error}`);
                }
            } catch (error) {
                console.error('Upload error:', error);
                alert("Connection error during upload.");
            } finally {
                attachBtn.classList.remove('loading');
                fileUploadInput.value = ''; // Reset for next selection
            }
        });
    }

    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => {
            fileChipContainer.style.display = 'none';
            // Note: In a real app, you might want to call a "delete" API as well
        });
    }

    // --- Theme Switching Logic ---
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'sun');
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-mode');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            
            if (toggleIcon) {
                toggleIcon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
                if (window.lucide) lucide.createIcons();
            }
        });
    }

    // --- Model Selection Logic ---
    if (modelSelectBtn && modelDropdown) {
        modelSelectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modelDropdown.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            modelDropdown.classList.remove('show');
        });

        modelOptions.forEach(option => {
            option.addEventListener('click', () => {
                selectedModel = option.dataset.model;
                currentModelName.innerText = option.querySelector('.m-name').innerText;
                
                modelOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                
                modelDropdown.classList.remove('show');
                if (window.lucide) lucide.createIcons();
            });
        });
    }

    // --- New Thread Handler ---
    if (newThreadBtn) {
        newThreadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const res = await fetch(`${API_BASE}/api/new_chat`, { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    currentThreadId = data.thread_id;
                    
                    // Reset UI to welcome screen
                    chatThread.innerHTML = '';
                    chatThread.style.display = 'none';
                    if (heroSection) heroSection.style.display = '';
                    suggestionsSection.style.display = 'block';
                    searchInput.value = '';
                    searchInput.style.height = 'auto';
                    
                    await refreshSidebar();
                }
            } catch (err) {
                console.error("Failed to start new thread", err);
            }
        });
    }

    // --- Search Handler (Streaming) ---
    const handleSearch = async () => {
        const prompt = searchInput.value.trim();
        if (!prompt || isSending) return;

        // Auto-create thread if none exists
        if (!currentThreadId) {
            try {
                const res = await fetch('/api/new_chat', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    currentThreadId = data.thread_id;
                }
            } catch (err) {
                console.error("Failed to auto-create thread", err);
                return;
            }
        }

        isSending = true;
        if (heroSection) heroSection.style.display = 'none';
        suggestionsSection.style.display = 'none';
        chatThread.style.display = 'flex';
        
        appendMessage('user', prompt);
        searchInput.value = '';
        searchInput.style.height = 'auto';

        // Prepare the model message container for streaming
        const modelMsgDiv = document.createElement('div');
        modelMsgDiv.className = 'chat-message model';
        modelMsgDiv.innerHTML = `
            <div class="message-header">
                <i data-lucide="sparkles"></i>
                <span>Answer</span>
            </div>
            <div class="message-content">
                <div class="loading-skeleton"><span class="loader"></span><span>Thinking...</span></div>
            </div>
        `;
        chatThread.appendChild(modelMsgDiv);
        if (window.lucide) lucide.createIcons();
        modelMsgDiv.scrollIntoView({ behavior: 'smooth' });

        const contentDiv = modelMsgDiv.querySelector('.message-content');
        let fullText = "";

        try {
            const response = await fetch('/api/chat_stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: prompt, 
                    thread_id: currentThreadId,
                    model_id: selectedModel
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({error: 'Network error'}));
                throw new Error(errData.error || 'Server error');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            
                            if (data.type === 'start') {
                                currentThreadId = data.thread_id;
                            } else if (data.type === 'chunk') {
                                if (isFirstChunk) {
                                    contentDiv.innerHTML = '';
                                    isFirstChunk = false;
                                }
                                fullText += data.content;
                                // Update content with Markdown
                                contentDiv.innerHTML = window.marked ? marked.parse(fullText) : `<p>${fullText}</p>`;
                                
                                // Re-run Lucide for any new icons and update copy buttons
                                // (We can optimize this to run only once at the end if performance is an issue)
                                modelMsgDiv.scrollIntoView({ behavior: 'auto' });
                            } else if (data.type === 'done') {
                                // Add sources and copy buttons
                                if (data.sources && data.sources.length > 0) {
                                    const sourcesHtml = `
                                        <div class="message-sources">
                                            <div class="sources-header"><i data-lucide="layers"></i><span>Sources</span></div>
                                            <div class="sources-list">
                                                ${data.sources.map((s, idx) => `
                                                    <a href="${s.url}" target="_blank" class="source-item">
                                                        <span class="source-idx">${idx + 1}</span>
                                                        <span class="source-title">${s.title}</span>
                                                    </a>
                                                `).join('')}
                                            </div>
                                        </div>
                                    `;
                                    // Prepend sources before content
                                    const sourcesWrapper = document.createElement('div');
                                    sourcesWrapper.innerHTML = sourcesHtml;
                                    modelMsgDiv.insertBefore(sourcesWrapper.firstElementChild, contentDiv);
                                }
                                
                                // Clean up and final rendering
                                setupCopyButtons(modelMsgDiv);
                                if (window.lucide) lucide.createIcons();
                                await refreshSidebar();
                            } else if (data.type === 'error') {
                                throw new Error(data.message);
                            }
                        } catch (e) {
                            console.error("Error parsing stream chunk:", e, line);
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Streaming error:', error);
            const errColor = '#ff5555';
            let msg = error.message.toLowerCase();
            
            if (msg.includes('failed to fetch') || msg.includes('network error') || msg.includes('load failed')) {
                msg = "Network Error: Please ensure you are opening this app via http://localhost:5000 and the backend server is running.";
            } else {
                msg = error.message; // Revert to original case if not a generic network error
            }
            
            contentDiv.innerHTML = `<span style="color: ${errColor};"><b>Error:</b> ${msg}</span>`;
        } finally {
            isSending = false;
            if (window.lucide) lucide.createIcons();
        }
    };

    // Helper to setup copy buttons in a message div
    const setupCopyButtons = (msgDiv) => {
        const preBlocks = msgDiv.querySelectorAll('pre');
        preBlocks.forEach(pre => {
            if (pre.querySelector('.copy-btn')) return; // Avoid duplicates
            
            const button = document.createElement('button');
            button.className = 'copy-btn';
            button.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
            pre.appendChild(button);
            
            button.addEventListener('click', () => {
                const codeEl = pre.querySelector('code');
                const code = codeEl ? codeEl.innerText : pre.innerText;
                navigator.clipboard.writeText(code).then(() => {
                    button.innerHTML = '<i data-lucide="check"></i><span>Copied!</span>';
                    setTimeout(() => {
                        button.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
                        if (window.lucide) lucide.createIcons();
                    }, 2000);
                    if (window.lucide) lucide.createIcons();
                });
            });
        });
    };

    if (searchInput) {
        searchInput.focus();
        searchInput.addEventListener('input', function() {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 200);
            this.style.height = newHeight + 'px';
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSearch();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', handleSearch);
    }

    // --- Suggestion Item Click Handler ---
    // Fix: Extract only the actual suggestion text, not chip labels
    document.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            // Get text content but exclude the chip span text
            const chipEl = item.querySelector('.chip');
            let text = item.textContent.trim();
            if (chipEl) {
                text = text.replace(chipEl.textContent.trim(), '').trim();
            }
            searchInput.value = text;
            searchInput.focus();
        });
    });

    // Main nav generic highlights
    navItems.forEach(item => {
        if (item.id !== 'new-thread-btn') {
            item.addEventListener('click', (e) => {
                navItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        }
    });

    tabPills.forEach(tab => {
        tab.addEventListener('click', () => {
            tabPills.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });
});
