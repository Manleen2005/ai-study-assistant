import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import DocumentUpload from './DocumentUpload';

// --- MAGIC: Custom Safe Text Formatter ---
const formatText = (text: string) => {
  if (!text || typeof text !== 'string') return text;
  return text.split('\n').map((line, i) => {
    const isBullet = line.trim().startsWith('* ') || line.trim().startsWith('- ');
    const cleanLine = isBullet ? line.trim().substring(2) : line;
    const formattedLine = cleanLine.split(/(\*\*.*?\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-bold text-gray-900">{part.slice(2, -2)}</strong>;
      }
      return <span key={j}>{part}</span>;
    });
    if (isBullet) {
      return (
        <div key={i} className="flex items-start gap-2 mt-2 ml-4">
          <span className="text-blue-500 font-bold mt-0.5">•</span>
          <span className="text-gray-700">{formattedLine}</span>
        </div>
      );
    }
    return <p key={i} className="mt-2 text-gray-700 leading-relaxed">{formattedLine}</p>;
  });
};
// -------------------------------------------------

// Set up Supabase Connection
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function App() {
  const [input, setInput] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [chats, setChats] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // CLERK AUTH: Get the VIP pass function and user ID
  const { getToken, userId } = useAuth();

  // CLOUD MEMORY: Authenticate with Supabase dynamically
  const getSupabase = async () => {
    const token = await getToken({ template: 'supabase' });
    return createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  };

  // FETCH ON LOAD: Grab chats from Supabase when the user logs in
  useEffect(() => {
    if (!userId) return; 

    const fetchChats = async () => {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        setChats(data);
        setActiveId(data[0].id);
      } else {
        createNewChat(); // Make a blank one if they have no history
      }
    };

    fetchChats();
  }, [userId]);

  // HELPER: Get the currently active chat
  const activeChat = chats.find(c => c.id === activeId);
  const messages = activeChat ? activeChat.messages : [];
  const currentFile = activeChat ? activeChat.file_name : null; 

  // HELPER: Update React UI AND Supabase Database simultaneously 
  const updateCurrentChat = async (updates: any) => {
    // 1. Update the UI instantly
    setChats(prevChats => prevChats.map(c => 
      c.id === activeId ? { ...c, ...updates } : c
    ));

    // 2. Save it to the Cloud quietly in the background
    const supabase = await getSupabase();
    await supabase.from('chats').update(updates).eq('id', activeId);
  };

  const createNewChat = async () => {
    setUploadStatus('');
    const supabase = await getSupabase();
    
    // Create the chat in Supabase first to get the real Database ID
    const { data, error } = await supabase.from('chats').insert([{
      user_id: userId,
      title: "New Conversation",
      messages: [{ role: 'ai', content: 'Hello! You can upload a PDF to begin studying.' }],
      file_name: null
    }]).select();

    if (data && data[0]) {
      setChats(prev => [data[0], ...prev]);
      setActiveId(data[0].id);
    }
  };

  // Old synchronous upload (Kept for small files if needed)
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
      
      if (data.status === "No text extracted") {
        setUploadStatus(`⚠️ Error: ${data.filename} contains no readable text.`);
        return;
      }

      setUploadStatus(`Success: ${data.filename} indexed!`);
      
      updateCurrentChat({
        file_name: data.filename,
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
          history: messages.slice(-6)
        }),
      });
      const data = await response.json();
      
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
    <>
      {/* ================= OUTSIDE/LOGGED OUT STATE ================= */}
      <SignedOut>
        <div className="min-h-screen relative flex flex-col items-center justify-center p-6 overflow-hidden bg-slate-50">
          
          {/* Ambient Background Glows */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
            <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-500/20 blur-[120px]"></div>
            <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] rounded-full bg-purple-500/20 blur-[120px]"></div>
          </div>

          {/* Main Glass Card */}
          <div className="relative z-10 bg-white/70 backdrop-blur-2xl p-10 sm:p-12 rounded-[2rem] shadow-2xl border border-white/60 text-center max-w-lg w-full">
            
            {/* Logo/Icon Graphic */}
            <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl mx-auto mb-8 flex items-center justify-center shadow-lg shadow-blue-500/30 transform transition-transform hover:scale-105 duration-300">
               <span className="text-4xl text-white">✨</span>
            </div>
            
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-gray-900 to-gray-600 mb-4 tracking-tight">
              AI Study Assistant
            </h1>
            
            <p className="text-gray-500 mb-10 text-lg leading-relaxed">
              Your personal AI tutor. Upload lectures, generate smart flashcards, and ace your exams in half the time.
            </p>
            
            {/* Premium Button */}
            <SignInButton mode="modal">
              <button className="group relative w-full flex items-center justify-center gap-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold py-4 px-8 rounded-2xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 overflow-hidden">
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <span className="relative z-10">Get Started Free</span>
                <svg className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </SignInButton>

            <p className="mt-6 text-sm text-gray-400 font-medium">Secure login powered by Clerk</p>
          </div>
        </div>
      </SignedOut>

      {/* ================= INSIDE/LOGGED IN STATE ================= */}
      <SignedIn>
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

            {/* Old Simple Upload (Optional - you can delete this block if you only want the new one!) */}
            <label className="border-2 border-dashed border-gray-600 rounded-xl p-4 text-center text-sm text-gray-400 hover:text-white cursor-pointer transition-colors mb-2 shrink-0">
              <input type="file" onChange={handleFileUpload} className="hidden" />
              📄 Quick Upload PDF
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

            {/* NEW: ASYNC DOCUMENT UPLOAD WIDGET IN SIDEBAR */}
            <div className="mt-4 shrink-0 overflow-hidden rounded-xl border border-gray-700 bg-gray-800/50">
              <div className="transform scale-90 origin-top-left w-[111%]"> 
                <DocumentUpload 
                  onUploadSuccess={(filename) => {
                    updateCurrentChat({
                      file_name: filename,
                      title: filename.replace('.pdf', '') + ' Q&A',
                      messages: [...messages, { role: 'ai', content: `✅ Background processing complete for ${filename}. You can now ask questions or click summarize!` }]
                    });
                  }}
                />
              </div>
            </div>

            {/* USER PROFILE BUMPER AT BOTTOM OF SIDEBAR */}
            <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium text-gray-400">My Account</span>
              <div className="bg-gray-800 rounded-full p-1 border border-gray-700">
                <UserButton afterSignOutUrl="/" />
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
      </SignedIn>
    </>
  );
}

export default App;