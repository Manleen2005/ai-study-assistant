import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react'; // FIXED: Type-only import for Vite strict mode

// --- MAGIC: Custom Safe Text Formatter ---
const formatText = (text: string) => {
  // SAFETY CHECK: If text is missing or not a string, return it safely to prevent blank screens!
  if (!text || typeof text !== 'string') return text;

  return text.split('\n').map((line, i) => {
    // Detect bullet points
    const isBullet = line.trim().startsWith('* ') || line.trim().startsWith('- ');
    const cleanLine = isBullet ? line.trim().substring(2) : line;

    // Detect and convert **bold** text
    const formattedLine = cleanLine.split(/(\*\*.*?\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-bold text-gray-900">{part.slice(2, -2)}</strong>;
      }
      return <span key={j}>{part}</span>;
    });

    // Render bullet points with a nice blue dot
    if (isBullet) {
      return (
        <div key={i} className="flex items-start gap-2 mt-2 ml-4">
          <span className="text-blue-500 font-bold mt-0.5">•</span>
          <span className="text-gray-700">{formattedLine}</span>
        </div>
      );
    }

    // Render normal paragraphs
    return <p key={i} className="mt-2 text-gray-700 leading-relaxed">{formattedLine}</p>;
  });
};
// -------------------------------------------------

function App() {
  const [input, setInput] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');

  // LEVEL 3 MEMORY: Load all chat sessions
  const [chats, setChats] = useState<any[]>(() => {
    const saved = localStorage.getItem('allChats');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    return localStorage.getItem('activeChatId') || null;
  });

  // If no chats exist at all, create a blank one on first load
  useEffect(() => {
    if (chats.length === 0) {
      createNewChat();
    }
  }, []);

  // Auto-save all chats to browser memory whenever they change
  useEffect(() => {
    localStorage.setItem('allChats', JSON.stringify(chats));
    if (activeId) localStorage.setItem('activeChatId', activeId);
  }, [chats, activeId]);

  // HELPER: Get the messages and file for the currently active chat
  const activeChat = chats.find(c => c.id === activeId);
  const messages = activeChat ? activeChat.messages : [];
  const currentFile = activeChat ? activeChat.currentFile : null;

  // HELPER: Update the current chat with new messages or titles
  const updateCurrentChat = (updates: any) => {
    setChats(prevChats => prevChats.map(c => 
      c.id === activeId ? { ...c, ...updates } : c
    ));
  };

  const createNewChat = () => {
    const newChat = {
      id: Date.now().toString(),
      title: "New Conversation",
      messages: [{ role: 'ai', content: 'Hello! Click "Upload PDF" in the sidebar to begin.' }],
      currentFile: null
    };
    setChats(prev => [newChat, ...prev]);
    setActiveId(newChat.id);
    setUploadStatus('');
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus(`Uploading ${file.name}...`);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      // SMART ERROR HANDLING: Catch empty/scanned PDFs
      if (data.status === "No text extracted") {
        setUploadStatus(`⚠️ Error: ${data.filename} contains no readable text (is it a scanned image?).`);
        return; // Stop here so we don't try to chat with an empty file
      }

      setUploadStatus(`Success: ${data.filename} indexed!`);
      
      // Auto-name the chat based on the PDF name
      updateCurrentChat({
        currentFile: data.filename,
        title: file.name.replace('.pdf', '') + ' Q&A',
        messages: [...messages, { role: 'ai', content: `Indexed: ${data.filename}. You can now ask questions!` }]
      });

    } catch (error) {
      setUploadStatus('Upload failed.');
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || !activeId) return;
    
    const newMessages = [...messages, { role: 'user', content: text }];
    updateCurrentChat({ messages: newMessages });
    setInput('');

    // Auto-name "New Conversation" if user types before uploading a PDF
    if (activeChat?.title === "New Conversation" && !currentFile) {
        updateCurrentChat({ title: text.substring(0, 20) + "..." });
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: text,
          filename: currentFile,
          history: messages.slice(-6) // Sends context to the backend!
        }),
      });
      const data = await response.json();
      
      // NEW: Catch hidden backend errors and print them to the screen
      if (data.detail) {
        updateCurrentChat({ messages: [...newMessages, { role: 'ai', content: `⚠️ Backend Error: ${JSON.stringify(data.detail)}` }] });
      } else {
        updateCurrentChat({ messages: [...newMessages, { role: 'ai', content: data.answer }] });
      }
      
    } catch (error) {
      updateCurrentChat({ messages: [...newMessages, { role: 'ai', content: "⚠️ Error connecting to backend server." }] });
    }
  };

  const handleSend = () => sendMessage(input);

  const handleQuickAction = (action: string) => {
    if (action === 'quiz') sendMessage("Act as a professor. Generate a 5-question multiple-choice quiz based entirely on this document. Provide the answer key at the very end.");
    else if (action === 'flashcards') sendMessage("Extract the top 10 most important key terms from this document. Format them strictly as study flashcards like this -> Term: Definition.");
    else if (action === 'summary') sendMessage("Provide a high-level, bulleted executive summary of the core concepts in this document.");
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-gray-900 text-white p-4 flex flex-col h-full overflow-hidden">
        <h2 className="text-xl font-bold mb-6 mt-2">AI Study Assistant</h2>
        
        <button 
          onClick={createNewChat}
          className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white px-4 py-2 rounded-lg font-medium mb-6 transition-colors shadow-sm flex items-center justify-center gap-2 shrink-0"
        >
          <span>+</span> New Chat
        </button>

        <label className="border-2 border-dashed border-gray-600 rounded-xl p-4 text-center text-sm text-gray-400 hover:text-white cursor-pointer transition-colors mb-2 shrink-0">
          <input type="file" onChange={handleFileUpload} className="hidden" />
          📄 Upload PDF
        </label>
        <p className="text-xs text-green-400 mb-8 text-center shrink-0">{uploadStatus}</p>

        {/* DYNAMIC CHAT HISTORY */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Chats</p>
          <div className="space-y-2">
            {chats.map(chat => (
              <button 
                key={chat.id}
                onClick={() => {
                    setActiveId(chat.id);
                    setUploadStatus(''); 
                }}
                className={`w-full text-left px-3 py-3 text-sm rounded-lg truncate transition-colors ${
                  activeId === chat.id 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                💬 {chat.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg: any, idx: number) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl rounded-2xl p-4 ${msg.role === 'user' ? 'bg-blue-600 text-white whitespace-pre-wrap' : 'bg-white border border-gray-200 shadow-sm'}`}>
                
                {/* Apply the custom formatter ONLY to the AI's responses */}
                {msg.role === 'user' ? msg.content : formatText(msg.content)}

              </div>
            </div>
          ))}
        </div>

        <div className="p-6 bg-white border-t border-gray-200">
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            
            <div className="flex gap-2 overflow-x-auto pb-2">
              <button onClick={() => handleQuickAction('quiz')} className="text-sm font-medium bg-purple-100 text-purple-700 px-4 py-2 rounded-full hover:bg-purple-200 transition-colors shadow-sm whitespace-nowrap">
                🎯 Generate Quiz
              </button>
              <button onClick={() => handleQuickAction('flashcards')} className="text-sm font-medium bg-green-100 text-green-700 px-4 py-2 rounded-full hover:bg-green-200 transition-colors shadow-sm whitespace-nowrap">
                🗂️ Create Flashcards
              </button>
              <button onClick={() => handleQuickAction('summary')} className="text-sm font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-full hover:bg-amber-200 transition-colors shadow-sm whitespace-nowrap">
                📝 Summarize
              </button>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask a question..."
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handleSend} className="bg-blue-600 hover:bg-blue-700 transition-colors text-white px-6 py-3 rounded-xl font-medium shadow-sm">
                Send
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default App;