import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

// --- Type definition for a history item ---
type HistoryItem = {
  id: string;
  baseImagePreviews: string[];
  prompt: string;
  generatedImage: string;
  seed: string;
};

// --- Helper function to convert file to a base64 part for the Gemini API ---
const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const App = () => {
  // --- State management ---
  const [baseImages, setBaseImages] = useState<File[]>([]);
  const [baseImagePreviews, setBaseImagePreviews] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>('');
  const [seed, setSeed] = useState<string>('');
  const [generatedImage, setGeneratedImage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'generator' | 'history'>('generator');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  
  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  // --- Handlers ---
  const processFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).slice(0, 3 - baseImages.length);
    if (newFiles.length === 0) return;

    setBaseImages(prev => [...prev, ...newFiles]);

    const newPreviews = newFiles.map(file => URL.createObjectURL(file));
    setBaseImagePreviews(prev => [...prev, ...newPreviews]);
    setGeneratedImage('');
    setError('');
  }, [baseImages.length]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };
  
  const handleRemoveImage = (indexToRemove: number) => {
    setBaseImages(prev => prev.filter((_, index) => index !== indexToRemove));
    setBaseImagePreviews(prev => {
        const newPreviews = prev.filter((_, index) => index !== indexToRemove);
        URL.revokeObjectURL(prev[indexToRemove]);
        return newPreviews;
    });
  }

  const handleDragEvents = (e: React.DragEvent<HTMLLabelElement>, isOver: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(isOver);
  }

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
      handleDragEvents(e, false);
      processFiles(e.dataTransfer.files);
  };
  
  const handleDownload = (imageUrl: string) => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `re-imagined-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImprovise = async (imageUrl: string) => {
    if (!imageUrl) return;
    
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const newFile = new File([blob], `improvised-${Date.now()}.png`, { type: blob.type });

      // Clean up old previews
      baseImagePreviews.forEach(url => URL.revokeObjectURL(url));

      setBaseImages([newFile]);
      // Use the image URL directly for preview, as it's a data URL and won't expire.
      setBaseImagePreviews([imageUrl]);
      setGeneratedImage('');
      setError('');

      if(selectedHistoryItem){
        setSelectedHistoryItem(null);
      }
      setActiveTab('generator');

    } catch (err) {
      console.error("Failed to create file from generated image:", err);
      setError("Could not use the generated image as a new base.");
    }
  };

  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear all history? This action cannot be undone.")) {
        setHistory([]);
    }
  };

  const clearInputs = () => {
    baseImagePreviews.forEach(url => URL.revokeObjectURL(url));
    setBaseImages([]);
    setBaseImagePreviews([]);
    setPrompt('');
    setSeed('');
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (baseImages.length === 0 || !prompt) {
      setError('Please upload at least one image and provide a prompt.');
      return;
    }

    setIsLoading(true);
    setError('');
    setGeneratedImage('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      
      const imageParts = await Promise.all(baseImages.map(file => fileToGenerativePart(file)));
      const textPart = { text: prompt };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [...imageParts, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });

      let foundImage = false;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64ImageBytes: string = part.inlineData.data;
          const mimeType = part.inlineData.mimeType;
          const imageUrl = `data:${mimeType};base64,${base64ImageBytes}`;
          setGeneratedImage(imageUrl);
          
          const newHistoryItem: HistoryItem = {
              id: `history-${Date.now()}`,
              baseImagePreviews: baseImages.length > 0 ? baseImagePreviews : [], // Handle direct data URL improv
              prompt: prompt,
              generatedImage: imageUrl,
              seed: seed,
          };
          setHistory(prev => [newHistoryItem, ...prev.slice(0, 19)]);
          clearInputs();
          foundImage = true;
          break;
        }
      }
      if (!foundImage) {
        setError("The AI didn't return an image. Try a different prompt.");
      }

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(`Error: ${errorMessage}. Please check the console for more details.`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Render ---
  return (
    <>
      <style>{`
        :root {
            --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
        }
        :root[data-theme='dark'] {
            --bg-primary: #121212;
            --bg-secondary: #1e1e1e;
            --bg-tertiary: #2a2a2a;
            --text-primary: #e0e0e0;
            --text-secondary: #a0a0a0;
            --border-primary: #333;
            --border-secondary: #444;
            --accent-primary: #007aff;
            --accent-secondary: #0a84ff;
            --error: #ff453a;
            --success: #30d158;
            --warn: #ff9f0a;
        }
        :root[data-theme='light'] {
            --bg-primary: #f0f2f5;
            --bg-secondary: #ffffff;
            --bg-tertiary: #e8e8e8;
            --text-primary: #1d1d1f;
            --text-secondary: #6e6e73;
            --border-primary: #dcdcdc;
            --border-secondary: #c8c8c8;
            --accent-primary: #007aff;
            --accent-secondary: #0071e3;
            --error: #d70015;
            --success: #28a745;
            --warn: #e67e22;
        }
        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            transition: background-color 0.3s ease, color 0.3s ease;
        }
        .main-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 1.5rem;
            box-sizing: border-box;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 0.5rem 1.5rem;
        }
        .header h1 { font-size: 1.75rem; margin: 0; font-weight: 700; }
        .theme-toggle {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-primary);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease, background-color 0.3s ease;
        }
        .theme-toggle:hover { transform: scale(1.1); }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--border-primary);
            margin-bottom: 1.5rem;
        }
        .tab-button {
            padding: 0.75rem 1.5rem;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            position: relative;
            transition: color 0.3s ease;
        }
        .tab-button.active { color: var(--accent-primary); }
        .tab-button.active::after {
            content: '';
            position: absolute;
            bottom: -1px;
            left: 0;
            width: 100%;
            height: 2px;
            background-color: var(--accent-primary);
        }
        .tab-content { animation: fadeIn 0.5s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        
        .generator-layout {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        @media (min-width: 900px) {
            .generator-layout { grid-template-columns: 400px 1fr; }
        }

        .controls-panel, .output-panel, .history-panel {
            background-color: var(--bg-secondary);
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .form-group { margin-bottom: 1.5rem; }
        .form-group label {
            display: block;
            font-weight: 600;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }

        .image-uploader {
            border: 2px dashed var(--border-primary);
            border-radius: 12px;
            padding: 1rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s var(--ease-out-quart);
            position: relative;
            min-height: 150px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }
        .image-uploader.dragging, .image-uploader:hover {
            border-color: var(--accent-primary);
            background-color: var(--bg-tertiary);
        }
        .image-uploader input[type="file"] { display: none; }

        .image-preview-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
            gap: 0.75rem;
            width: 100%;
        }
        .preview-item {
            position: relative;
            width: 100%;
            padding-top: 100%;
        }
        .preview-item img {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 8px;
        }
        .remove-image-btn {
            position: absolute;
            top: -5px;
            right: -5px;
            background: var(--bg-primary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-radius: 50%;
            width: 24px;
            height: 24px;
            font-size: 14px;
            line-height: 22px;
            text-align: center;
            cursor: pointer;
            opacity: 0;
            transform: scale(0.8);
            transition: all 0.2s ease;
        }
        .preview-item:hover .remove-image-btn { opacity: 1; transform: scale(1); }
        .uploader-icon { margin-bottom: 0.5rem; }

        textarea.prompt-input, input.seed-input {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--bg-primary);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            padding: 0.75rem;
            color: var(--text-primary);
            font-size: 1rem;
            transition: all 0.2s ease;
        }
        textarea.prompt-input { resize: vertical; min-height: 120px; }
        textarea.prompt-input:focus, input.seed-input:focus {
            outline: none;
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 20%, transparent);
        }

        .submit-button {
            width: 100%;
            background: var(--accent-primary);
            color: white;
            border: none;
            border-radius: 10px;
            padding: 0.85rem 1rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        .submit-button:hover:not(:disabled) { background-color: var(--accent-secondary); transform: translateY(-2px); }
        .submit-button:disabled { background-color: var(--border-secondary); cursor: not-allowed; }

        .output-panel {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
        }
        .output-placeholder, .error-message { color: var(--text-secondary); text-align: center; padding: 1rem; }
        .error-message {
            color: var(--error);
            font-weight: 500;
            background-color: color-mix(in srgb, var(--error) 10%, transparent);
            border: 1px solid var(--error);
            border-radius: 8px;
            word-break: break-word;
        }
        .generated-image-container {
            width: 100%;
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
            margin-bottom: 1rem;
        }
        .generated-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 12px; }
        .spinner {
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .output-actions { display: flex; gap: 0.75rem; }
        .action-button {
            border: none;
            border-radius: 10px;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .action-button:hover { opacity: 0.85; }
        .download-button { background-color: var(--success); color: white; }
        .improvise-button { background-color: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-primary); }

        .history-header { display: flex; justify-content: flex-end; margin-bottom: 1rem; }
        .clear-history-button {
            background-color: var(--bg-tertiary);
            color: var(--warn);
            border: 1px solid var(--border-primary);
            border-radius: 8px;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .clear-history-button:hover { background-color: var(--warn); color: var(--bg-secondary); border-color: var(--warn); }
        .history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 1rem; }
        .history-item {
            position: relative;
            cursor: pointer;
            border-radius: 12px;
            overflow: hidden;
            border: 2px solid transparent;
            transition: all 0.2s ease;
            aspect-ratio: 1/1;
        }
        .history-item:hover { transform: scale(1.05); border-color: var(--accent-primary); }
        .history-item img { display: block; width: 100%; height: 100%; object-fit: cover; }
        
        /* --- Modal Styles --- */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.3s ease;
        }
        .modal-content {
            background: var(--bg-secondary);
            padding: 1.5rem;
            border-radius: 16px;
            max-width: 90vw;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            animation: zoomIn 0.3s var(--ease-out-quart);
        }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        .modal-close-btn {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: var(--bg-tertiary);
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            font-size: 1.5rem;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            transition: all 0.2s ease;
            z-index: 10;
        }
        .modal-close-btn:hover {
            background: var(--border-primary);
            color: var(--text-primary);
        }
        .modal-image-container {
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
            min-height: 0;
        }
        .modal-image {
            max-width: 100%;
            max-height: 70vh;
            object-fit: contain;
            border-radius: 12px;
        }
        .modal-actions {
            display: flex;
            justify-content: center;
            gap: 1rem;
        }
      `}</style>
      <main className="main-container">
        <header className="header">
          <h1>Re-imaginator</h1>
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </header>

        <nav className="tabs">
          <button className={`tab-button ${activeTab === 'generator' ? 'active' : ''}`} onClick={() => setActiveTab('generator')}>Generator</button>
          <button className={`tab-button ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>History</button>
        </nav>

        {activeTab === 'generator' && (
          <div className="tab-content">
            <div className="generator-layout">
              <div className="controls-panel">
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label htmlFor="image-upload">Base Images</label>
                    <label 
                      htmlFor="image-upload" 
                      className={`image-uploader ${isDragging ? 'dragging' : ''}`}
                      role="button" 
                      onDragOver={(e) => handleDragEvents(e, true)}
                      onDragLeave={(e) => handleDragEvents(e, false)}
                      onDrop={handleDrop}
                    >
                      <input id="image-upload" type="file" accept="image/*" onChange={handleImageChange} multiple disabled={baseImages.length >= 3} />
                      {baseImagePreviews.length > 0 ? (
                          <div className="image-preview-container">
                              {baseImagePreviews.map((src, index) => (
                                  <div key={src} className="preview-item">
                                      <img src={src} alt={`Preview ${index + 1}`} />
                                      <button type="button" className="remove-image-btn" onClick={() => handleRemoveImage(index)} aria-label={`Remove image ${index + 1}`}>×</button>
                                  </div>
                              ))}
                          </div>
                      ) : (
                        <div>
                          <div className="uploader-icon" style={{fontSize: '2rem'}}>🖼️</div>
                          <span style={{color: 'var(--text-secondary)'}}>Upload (up to 3)</span>
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="form-group">
                    <label htmlFor="prompt">Prompt</label>
                    <textarea id="prompt" className="prompt-input" placeholder="e.g., 'add a majestic castle...'" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}></textarea>
                  </div>
                  
                  <div className="form-group">
                      <label htmlFor="seed">Seed (Optional)</label>
                      <input id="seed" type="number" className="seed-input" placeholder="For consistent results" value={seed} onChange={(e) => setSeed(e.target.value)} />
                  </div>
                  
                  <button type="submit" className="submit-button" disabled={isLoading || baseImages.length === 0 || !prompt}>
                    {isLoading ? <div className="spinner"></div> : '✨'}
                    {isLoading ? 'Generating...' : 'Re-imagine'}
                  </button>

                  {error && <p className="error-message" role="alert" style={{marginTop: '1rem'}}>{error}</p>}
                </form>
              </div>

              <div className="output-panel">
                <div className="generated-image-container">
                  {isLoading && (
                    <div className="output-placeholder">
                        <div className="spinner" style={{width: '40px', height: '40px', marginBottom: '1rem', borderTopColor: 'var(--text-primary)'}}></div>
                        <p>The AI is creating...</p>
                    </div>
                  )}
                  {!isLoading && !generatedImage && (
                    <p className="output-placeholder">Your re-imagined image will appear here.</p>
                  )}
                  {generatedImage && (
                    <img src={generatedImage} alt="Generated by AI" className="generated-image" />
                  )}
                </div>
                {generatedImage && !isLoading && (
                  <div className="output-actions">
                    <button className="action-button improvise-button" onClick={() => handleImprovise(generatedImage)} title="Improvise image">
                      <span>✎</span> Improvise
                    </button>
                    <button className="action-button download-button" onClick={() => handleDownload(generatedImage)}>Download</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'history' && (
          <div className="tab-content history-panel">
              {history.length > 0 ? (
                <>
                  <div className="history-header">
                      <button className="clear-history-button" onClick={handleClearHistory}>Clear History</button>
                  </div>
                  <div className="history-grid">
                      {history.map(item => (
                          <div key={item.id} className="history-item" onClick={() => setSelectedHistoryItem(item)} title={`Prompt: ${item.prompt}`}>
                              <img src={item.generatedImage} alt="Generated history item" />
                          </div>
                      ))}
                  </div>
                </>
              ) : (
                <p className="output-placeholder">Your generation history is empty.</p>
              )}
          </div>
        )}

      </main>

      {selectedHistoryItem && (
          <div className="modal-overlay" onClick={() => setSelectedHistoryItem(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <button className="modal-close-btn" onClick={() => setSelectedHistoryItem(null)} aria-label="Close image view">&times;</button>
                  <div className="modal-image-container">
                      <img src={selectedHistoryItem.generatedImage} alt="Selected from history" className="modal-image" />
                  </div>
                  <div className="modal-actions">
                      <button className="action-button improvise-button" onClick={() => handleImprovise(selectedHistoryItem.generatedImage)} title="Improvise image">
                        <span>✎</span> Improvise
                      </button>
                      <button className="action-button download-button" onClick={() => handleDownload(selectedHistoryItem.generatedImage)}>Download</button>
                  </div>
              </div>
          </div>
      )}
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);