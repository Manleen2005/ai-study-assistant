import React, { useState, useEffect } from 'react';

// NEW: We accept a callback function so we can talk to App.tsx!
const DocumentUpload = ({ onUploadSuccess }: { onUploadSuccess?: (filename: string) => void }) => {
  const [file, setFile] = useState<File | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState('IDLE'); 
  const [progressData, setProgressData] = useState<any>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setStatus('UPLOADING');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/upload-async', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      if (data.task_id) {
        setTaskId(data.task_id);
        setStatus('PROCESSING');
      }
    } catch (error) {
      setStatus('ERROR');
    }
  };

  useEffect(() => {
    let pollInterval: any;

    if (taskId && status === 'PROCESSING') {
      pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8000/api/task-status/${taskId}`);
          const data = await response.json();

          if (data.status === 'SUCCESS') {
            clearInterval(pollInterval);
            setStatus('SUCCESS');
            setTaskId(null); 
            
            // NEW: Tell the main chat window that the file is ready!
            if (onUploadSuccess && file) {
              onUploadSuccess(file.name);
            }
          } else if (data.status === 'PROCESSING' && data.progress) {
            setProgressData(data.progress);
          } else if (data.status === 'FAILURE') {
            clearInterval(pollInterval);
            setStatus('ERROR');
          }
        } catch (error) {
          clearInterval(pollInterval);
          setStatus('ERROR');
        }
      }, 2000); 
    }

    return () => clearInterval(pollInterval);
  }, [taskId, status, file, onUploadSuccess]);

  return (
    <div className="p-4">
      <form onSubmit={handleUpload} className="flex flex-col gap-3">
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={(e) => setFile(e.target.files?.[0] || null)} 
          disabled={status === 'UPLOADING' || status === 'PROCESSING'}
          className="text-xs text-gray-300 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-gray-700 file:text-white cursor-pointer"
        />
        <button 
          type="submit" 
          disabled={!file || status === 'UPLOADING' || status === 'PROCESSING'}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors"
        >
          {status === 'UPLOADING' ? 'Uploading...' : 'Analyze Textbook'}
        </button>
      </form>

      {status === 'PROCESSING' && (
        <div className="mt-4 bg-gray-900 p-3 rounded-lg border border-gray-700">
          <p className="text-xs text-blue-400 mb-2">⚙️ AI is reading...</p>
          {progressData ? (
            <div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div style={{ 
                  height: '100%', 
                  background: '#3b82f6', 
                  width: `${(progressData.current_page / progressData.total_pages) * 100}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Initializing worker...</p>
          )}
        </div>
      )}

      {status === 'SUCCESS' && (
        <div className="mt-4 text-xs text-green-400 bg-green-900/20 p-2 rounded border border-green-800">
          ✅ Analysis Complete!
        </div>
      )}
    </div>
  );
};

export default DocumentUpload;