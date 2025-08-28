import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

// --- Type definition for aspect ratio ---
type AspectRatio = '1:1' | '16:9' | '9:16';

// --- Type definition for a history item ---
type HistoryItem = {
  id: string;
  baseImagePreviews: string[];
  prompt: string;
  generatedImage: string;
  seed: string;
  aspectRatio: AspectRatio;
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
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
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
    setAspectRatio('1:1');
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
      const finalPrompt = `${prompt}\n\n**IMPORTANT**: The output image must have a strict aspect ratio of exactly ${aspectRatio}. This is a critical requirement.`;
      const textPart = { text: finalPrompt };

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
              aspectRatio: aspectRatio,
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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        
        :root {
            --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
            --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        
        :root[data-theme='dark'] {
            --bg-primary: #0a0a0a;
            --bg-secondary: #141414;
            --bg-tertiary: #1f1f1f;
            --bg-card: #1a1a1a;
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
            --text-tertiary: #6b6b6b;
            --border-primary: rgba(255, 255, 255, 0.08);
            --border-secondary: rgba(255, 255, 255, 0.12);
            --accent-primary: #6366f1;
            --accent-secondary: #818cf8;
            --accent-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --accent-glow: rgba(99, 102, 241, 0.4);
            --error: #ef4444;
            --error-bg: rgba(239, 68, 68, 0.1);
            --success: #10b981;
            --success-bg: rgba(16, 185, 129, 0.1);
            --warn: #f59e0b;
            --glass-bg: rgba(20, 20, 20, 0.7);
            --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
            --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
            --shadow-lg: 0 20px 48px rgba(0, 0, 0, 0.5);
            --shadow-xl: 0 32px 64px rgba(0, 0, 0, 0.6);
        }
        
        :root[data-theme='light'] {
            --bg-primary: #fafafa;
            --bg-secondary: #ffffff;
            --bg-tertiary: #f3f4f6;
            --bg-card: #ffffff;
            --text-primary: #111827;
            --text-secondary: #6b7280;
            --text-tertiary: #9ca3af;
            --border-primary: rgba(0, 0, 0, 0.06);
            --border-secondary: rgba(0, 0, 0, 0.1);
            --accent-primary: #6366f1;
            --accent-secondary: #4f46e5;
            --accent-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --accent-glow: rgba(99, 102, 241, 0.2);
            --error: #dc2626;
            --error-bg: rgba(220, 38, 38, 0.1);
            --success: #059669;
            --success-bg: rgba(5, 150, 105, 0.1);
            --warn: #d97706;
            --glass-bg: rgba(255, 255, 255, 0.7);
            --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
            --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);
            --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.15);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: var(--bg-primary);
            color: var(--text-primary);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            transition: all 0.3s ease;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(circle at 20% 50%, var(--accent-glow) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 40% 20%, rgba(236, 72, 153, 0.05) 0%, transparent 50%);
            pointer-events: none;
            z-index: 0;
        }
        
        .main-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
            position: relative;
            z-index: 1;
        }
        
        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2rem 0;
            margin-bottom: 2rem;
            position: relative;
        }
        
        .logo-section {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .logo {
            width: 48px;
            height: 48px;
            background: var(--accent-gradient);
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: 700;
            color: white;
            box-shadow: 0 8px 24px var(--accent-glow);
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
        }
        
        .header h1 {
            font-size: 2rem;
            font-weight: 800;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: -0.02em;
        }
        
        .header-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .theme-toggle {
            width: 52px;
            height: 52px;
            border-radius: 16px;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-primary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.4rem;
            transition: all 0.3s var(--ease-spring);
            position: relative;
            overflow: hidden;
        }
        
        .theme-toggle:hover {
            transform: translateY(-2px) scale(1.05);
            box-shadow: var(--shadow-md);
            border-color: var(--accent-primary);
        }
        
        .theme-toggle:active {
            transform: scale(0.95);
        }
        
        /* Tabs */
        .tabs {
            display: flex;
            gap: 0.5rem;
            padding: 0.5rem;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid var(--border-primary);
            margin-bottom: 2rem;
            width: fit-content;
        }
        
        .tab-button {
            padding: 0.875rem 2rem;
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            border-radius: 14px;
            transition: all 0.3s var(--ease-out-quart);
            position: relative;
            letter-spacing: 0.01em;
        }
        
        .tab-button:hover {
            color: var(--text-primary);
        }
        
        .tab-button.active {
            background: var(--accent-gradient);
            color: white;
            box-shadow: 0 8px 24px var(--accent-glow);
        }
        
        .tab-button .tab-icon {
            display: inline-block;
            margin-right: 0.5rem;
            font-size: 1.1rem;
            vertical-align: middle;
        }
        
        /* Generator Layout */
        .generator-layout {
            display: grid;
            grid-template-columns: 1fr;
            gap: 2rem;
        }
        
        @media (min-width: 1024px) {
            .generator-layout {
                grid-template-columns: 440px 1fr;
            }
        }
        
        /* Card Styles */
        .card {
            background: var(--bg-card);
            border-radius: 24px;
            padding: 2rem;
            border: 1px solid var(--border-primary);
            box-shadow: var(--shadow-md);
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .card:hover::before {
            opacity: 1;
        }
        
        .card-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-primary);
        }
        
        .card-icon {
            width: 40px;
            height: 40px;
            background: var(--accent-gradient);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
        }
        
        .card-title {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }
        
        /* Form Styles */
        .form-group {
            margin-bottom: 2rem;
        }
        
        .form-label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
            margin-bottom: 0.875rem;
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .form-label-icon {
            font-size: 1rem;
        }
        
        /* Image Uploader */
        .image-uploader {
            border: 2px dashed var(--border-secondary);
            border-radius: 20px;
            padding: 2rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s var(--ease-out-quart);
            position: relative;
            min-height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            overflow: hidden;
        }
        
        .image-uploader::before {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--accent-gradient);
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .image-uploader.dragging::before,
        .image-uploader:hover::before {
            opacity: 0.05;
        }
        
        .image-uploader.dragging {
            border-color: var(--accent-primary);
            border-style: solid;
            transform: scale(1.02);
        }
        
        .image-uploader:hover {
            border-color: var(--accent-primary);
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.1);
        }
        
        .image-uploader input[type="file"] {
            display: none;
        }
        
        .upload-placeholder {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
            z-index: 1;
            position: relative;
        }
        
        .upload-icon {
            width: 64px;
            height: 64px;
            background: var(--accent-gradient);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            box-shadow: 0 12px 32px var(--accent-glow);
            animation: pulse 2s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
        }
        
        .upload-text {
            color: var(--text-primary);
            font-weight: 600;
            font-size: 1rem;
        }
        
        .upload-subtext {
            color: var(--text-tertiary);
            font-size: 0.875rem;
        }
        
        /* Image Preview */
        .image-preview-container {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            width: 100%;
            z-index: 1;
            position: relative;
        }
        
        .preview-item {
            position: relative;
            aspect-ratio: 1;
            border-radius: 16px;
            overflow: hidden;
            animation: fadeInScale 0.3s var(--ease-spring);
        }
        
        @keyframes fadeInScale {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
        }
        
        .preview-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        }
        
        .preview-item:hover img {
            transform: scale(1.05);
        }
        
        .remove-image-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 28px;
            height: 28px;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            color: white;
            border: none;
            border-radius: 50%;
            font-size: 16px;
            cursor: pointer;
            opacity: 0;
            transform: scale(0.8);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .preview-item:hover .remove-image-btn {
            opacity: 1;
            transform: scale(1);
        }
        
        .remove-image-btn:hover {
            background: var(--error);
            transform: scale(1.1);
        }
        
        /* Input Fields */
        .input-field {
            width: 100%;
            background: var(--bg-primary);
            border: 2px solid var(--border-primary);
            border-radius: 16px;
            padding: 1rem;
            color: var(--text-primary);
            font-size: 0.95rem;
            font-family: inherit;
            transition: all 0.3s ease;
            outline: none;
        }
        
        .input-field:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 4px var(--accent-glow);
            background: var(--bg-secondary);
        }
        
        .input-field::placeholder {
            color: var(--text-tertiary);
        }
        
        textarea.input-field {
            resize: vertical;
            min-height: 140px;
            line-height: 1.5;
        }
        
        .aspect-ratio-selector {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0.5rem;
            background: var(--bg-primary);
            border: 1px solid var(--border-primary);
            border-radius: 16px;
            padding: 0.25rem;
        }

        .aspect-ratio-btn {
            padding: 0.75rem;
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            border-radius: 12px;
            transition: all 0.3s var(--ease-out-quart);
            text-align: center;
        }

        .aspect-ratio-btn:hover:not(.active) {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }

        .aspect-ratio-btn.active {
            background: var(--accent-gradient);
            color: white;
            box-shadow: 0 4px 12px var(--accent-glow);
        }
        
        /* Buttons */
        .btn {
            border: none;
            border-radius: 16px;
            padding: 1rem 2rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s var(--ease-out-quart);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            text-transform: none;
            letter-spacing: 0.01em;
            position: relative;
            overflow: hidden;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-primary {
            background: var(--accent-gradient);
            color: white;
            box-shadow: 0 8px 24px var(--accent-glow);
            width: 100%;
            height: 56px;
            font-size: 1.05rem;
        }
        
        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 12px 32px var(--accent-glow);
        }
        
        .btn-primary:active:not(:disabled) {
            transform: translateY(0);
        }
        
        .btn-icon {
            font-size: 1.3rem;
        }
        
        .btn-secondary {
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
        }
        
        .btn-secondary:hover:not(:disabled) {
            background: var(--bg-tertiary);
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
        }
        
        .btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
        }
        
        .btn-success:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 12px 32px rgba(16, 185, 129, 0.4);
        }
        
        .btn-danger {
            background: transparent;
            color: var(--error);
            border: 1px solid var(--error);
        }
        
        .btn-danger:hover:not(:disabled) {
            background: var(--error);
            color: white;
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
        }
        
        /* Output Panel */
        .output-panel {
            display: flex;
            flex-direction: column;
            min-height: 600px;
        }
        
        .output-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 20px;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 2px dashed var(--border-primary);
            margin-bottom: 1.5rem;
            padding: 2rem;
            position: relative;
            overflow: hidden;
        }
        
        .output-container.has-image {
            border-style: solid;
            background: var(--bg-primary);
            padding: 0;
        }
        
        .generated-image {
            width: 100%;
            height: 100%;
            object-fit: contain;
            border-radius: 20px;
            animation: fadeIn 0.5s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        
        .output-placeholder {
            text-align: center;
            color: var(--text-tertiary);
        }
        
        .placeholder-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        .placeholder-text {
            font-size: 1.1rem;
            font-weight: 500;
            color: var(--text-secondary);
        }
        
        /* Loading State */
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1.5rem;
        }
        
        .loader {
            width: 60px;
            height: 60px;
            position: relative;
        }
        
        .loader-ring {
            position: absolute;
            width: 100%;
            height: 100%;
            border: 3px solid transparent;
            border-radius: 50%;
            border-top-color: var(--accent-primary);
            animation: spin 1s linear infinite;
        }
        
        .loader-ring:nth-child(2) {
            width: 80%;
            height: 80%;
            top: 10%;
            left: 10%;
            border-top-color: var(--accent-secondary);
            animation-duration: 0.8s;
            animation-direction: reverse;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .loading-text {
            font-size: 1rem;
            color: var(--text-secondary);
            font-weight: 500;
            animation: pulse-text 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse-text {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        
        /* Error Message */
        .error-message {
            background: var(--error-bg);
            border: 1px solid var(--error);
            color: var(--error);
            padding: 1rem 1.25rem;
            border-radius: 12px;
            margin-top: 1rem;
            font-size: 0.9rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            animation: shake 0.3s ease;
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }
        
        .error-icon {
            font-size: 1.2rem;
        }
        
        /* Action Buttons */
        .output-actions {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }
        
        .output-actions .btn {
            flex: 1;
            min-width: 140px;
        }
        
        /* History Panel */
        .history-panel {
            animation: fadeIn 0.5s ease;
        }
        
        .history-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
        }
        
        .history-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .history-count {
            background: var(--accent-gradient);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .history-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 1.25rem;
        }
        
        .history-item {
            position: relative;
            aspect-ratio: 1;
            border-radius: 20px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.3s var(--ease-out-quart);
            box-shadow: var(--shadow-sm);
            background: var(--bg-card);
            border: 2px solid transparent;
        }
        
        .history-item::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.7) 100%);
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 1;
        }
        
        .history-item:hover {
            transform: translateY(-8px) scale(1.02);
            box-shadow: var(--shadow-lg);
            border-color: var(--accent-primary);
        }
        
        .history-item:hover::before {
            opacity: 1;
        }
        
        .history-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        }
        
        .history-item:hover img {
            transform: scale(1.1);
        }
        
        .history-item-number {
            position: absolute;
            top: 12px;
            left: 12px;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
            z-index: 2;
            opacity: 0;
            transform: scale(0.8);
            transition: all 0.3s ease;
        }
        
        .history-item:hover .history-item-number {
            opacity: 1;
            transform: scale(1);
        }
        
        .empty-history {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-tertiary);
        }
        
        .empty-history-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        .empty-history-text {
            font-size: 1.1rem;
            font-weight: 500;
            color: var(--text-secondary);
        }
        
        /* Modal */
        .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.9);
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            animation: fadeIn 0.2s ease;
            padding: 2rem;
        }
        
        .modal-content {
            background: var(--bg-card);
            border-radius: 24px;
            width: 90vw;
            max-width: 1200px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: var(--shadow-xl);
            animation: modalSlideIn 0.3s var(--ease-spring);
            border: 1px solid var(--border-primary);
            overflow: hidden;
        }
        
        @keyframes modalSlideIn {
            from { opacity: 0; transform: scale(0.9) translateY(20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }
        
        .modal-header {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--border-primary);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        
        .modal-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text-primary);
        }
        
        .modal-close-btn {
            width: 40px;
            height: 40px;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-primary);
            border-radius: 12px;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            transition: all 0.2s ease;
        }
        
        .modal-close-btn:hover {
            background: var(--error);
            color: white;
            transform: scale(1.1);
            border-color: var(--error);
        }
        
        .modal-body {
            padding: 2rem;
            flex: 1;
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 2rem;
            background: var(--bg-primary);
            overflow-y: auto;
            align-items: start;
        }
        
        .modal-image-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0; /* Fix for flexbox in grid */
        }

        .modal-image {
            max-width: 100%;
            height: auto;
            object-fit: contain;
            border-radius: 16px;
            box-shadow: var(--shadow-lg);
        }

        .modal-details {
            padding: 1.5rem;
            background: var(--bg-tertiary);
            border-radius: 16px;
            border: 1px solid var(--border-primary);
        }

        .modal-details h3 {
            margin-bottom: 1.5rem;
            font-weight: 700;
            border-bottom: 1px solid var(--border-primary);
            padding-bottom: 1rem;
        }

        .detail-item {
            margin-bottom: 1rem;
        }

        .detail-item strong {
            display: block;
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .detail-item p {
            font-size: 0.95rem;
            color: var(--text-primary);
            word-wrap: break-word;
        }
        
        .modal-footer {
            padding: 1.5rem 2rem;
            border-top: 1px solid var(--border-primary);
            display: flex;
            justify-content: center;
            gap: 1rem;
            flex-shrink: 0;
        }
        
        /* Responsive */
        @media (max-width: 1024px) {
            .modal-body {
                grid-template-columns: 1fr;
                padding: 1.5rem;
            }
        }

        @media (max-width: 768px) {
            .main-container {
                padding: 1rem;
            }
            
            .header h1 {
                font-size: 1.5rem;
            }
            
            .tabs {
                width: 100%;
            }
            
            .card {
                padding: 1.5rem;
            }
            
            .history-grid {
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            }
            
            .modal-content {
                width: 100%;
                height: 100%;
                max-width: 100%;
                max-height: 100%;
                border-radius: 0;
            }

            .modal-overlay {
                padding: 0;
            }
        }
      `}</style>
      
      <main className="main-container">
        <header className="header">
          <div className="logo-section">
            <div className="logo">✨</div>
            <h1>Re-imaginator</h1>
          </div>
          <div className="header-actions">
            <button 
              className="theme-toggle" 
              onClick={toggleTheme} 
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </header>

        <nav className="tabs">
          <button 
            className={`tab-button ${activeTab === 'generator' ? 'active' : ''}`} 
            onClick={() => setActiveTab('generator')}
          >
            <span className="tab-icon">🎨</span>
            Generator
          </button>
          <button 
            className={`tab-button ${activeTab === 'history' ? 'active' : ''}`} 
            onClick={() => setActiveTab('history')}
          >
            <span className="tab-icon">📚</span>
            History
          </button>
        </nav>

        {activeTab === 'generator' && (
          <div className="tab-content">
            <div className="generator-layout">
              <div className="card">
                <div className="card-header">
                  <div className="card-icon">🎯</div>
                  <h2 className="card-title">Creation Studio</h2>
                </div>
                
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label className="form-label">
                      <span className="form-label-icon">📸</span>
                      Base Images
                    </label>
                    <label 
                      htmlFor="image-upload" 
                      className={`image-uploader ${isDragging ? 'dragging' : ''}`}
                      role="button" 
                      onDragOver={(e) => handleDragEvents(e, true)}
                      onDragLeave={(e) => handleDragEvents(e, false)}
                      onDrop={handleDrop}
                    >
                      <input 
                        id="image-upload" 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageChange} 
                        multiple 
                        disabled={baseImages.length >= 3} 
                      />
                      {baseImagePreviews.length > 0 ? (
                        <div className="image-preview-container">
                          {baseImagePreviews.map((src, index) => (
                            <div key={src} className="preview-item">
                              <img src={src} alt={`Preview ${index + 1}`} />
                              <button 
                                type="button" 
                                className="remove-image-btn" 
                                onClick={() => handleRemoveImage(index)} 
                                aria-label={`Remove image ${index + 1}`}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="upload-placeholder">
                          <div className="upload-icon">📤</div>
                          <div className="upload-text">Drop images here or click to browse</div>
                          <div className="upload-subtext">Upload up to 3 images • JPG, PNG, GIF</div>
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="prompt">
                      <span className="form-label-icon">✏️</span>
                      Creative Prompt
                    </label>
                    <textarea 
                      id="prompt" 
                      className="input-field" 
                      placeholder="Describe your vision... (e.g., 'Transform into a cyberpunk cityscape with neon lights')" 
                      value={prompt} 
                      onChange={(e) => setPrompt(e.target.value)} 
                      rows={5}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">
                      <span className="form-label-icon">📏</span>
                      Aspect Ratio
                    </label>
                    <div className="aspect-ratio-selector">
                      {(['1:1', '16:9', '9:16'] as const).map(ratio => (
                        <button
                          key={ratio}
                          type="button"
                          className={`aspect-ratio-btn ${aspectRatio === ratio ? 'active' : ''}`}
                          onClick={() => setAspectRatio(ratio)}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label" htmlFor="seed">
                      <span className="form-label-icon">🎲</span>
                      Seed (Optional)
                    </label>
                    <input 
                      id="seed" 
                      type="number" 
                      className="input-field" 
                      placeholder="Enter a number for consistent results" 
                      value={seed} 
                      onChange={(e) => setSeed(e.target.value)} 
                    />
                  </div>
                  
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={isLoading || baseImages.length === 0 || !prompt}
                  >
                    {isLoading ? (
                      <>
                        <div className="loader" style={{width: '20px', height: '20px'}}>
                          <div className="loader-ring"></div>
                          <div className="loader-ring"></div>
                        </div>
                        Generating Magic...
                      </>
                    ) : (
                      <>
                        <span className="btn-icon">🪄</span>
                        Generate Masterpiece
                      </>
                    )}
                  </button>

                  {error && (
                    <div className="error-message" role="alert">
                      <span className="error-icon">⚠️</span>
                      {error}
                    </div>
                  )}
                </form>
              </div>

              <div className="card output-panel">
                <div className="card-header">
                  <div className="card-icon">🖼️</div>
                  <h2 className="card-title">Generated Artwork</h2>
                </div>
                
                <div className={`output-container ${generatedImage ? 'has-image' : ''}`}>
                  {isLoading && (
                    <div className="loading-container">
                      <div className="loader">
                        <div className="loader-ring"></div>
                        <div className="loader-ring"></div>
                      </div>
                      <div className="loading-text">AI is crafting your masterpiece...</div>
                    </div>
                  )}
                  
                  {!isLoading && !generatedImage && (
                    <div className="output-placeholder">
                      <div className="placeholder-icon">🎨</div>
                      <div className="placeholder-text">Your AI-generated artwork will appear here</div>
                    </div>
                  )}
                  
                  {generatedImage && !isLoading && (
                    <img src={generatedImage} alt="Generated by AI" className="generated-image" />
                  )}
                </div>
                
                {generatedImage && !isLoading && (
                  <div className="output-actions">
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleImprovise(generatedImage)} 
                      title="Use as new base image"
                    >
                      <span>🔄</span> Improvise
                    </button>
                    <button 
                      className="btn btn-success" 
                      onClick={() => handleDownload(generatedImage)}
                    >
                      <span>💾</span> Download
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'history' && (
          <div className="tab-content">
            <div className="card history-panel">
              {history.length > 0 ? (
                <>
                  <div className="history-header">
                    <div className="history-title">
                      <span>🕐</span>
                      Recent Creations
                      <span className="history-count">{history.length}</span>
                    </div>
                    <button 
                      className="btn btn-danger" 
                      onClick={handleClearHistory}
                      style={{padding: '0.75rem 1.5rem', fontSize: '0.9rem'}}
                    >
                      <span>🗑️</span> Clear All
                    </button>
                  </div>
                  
                  <div className="history-grid">
                    {history.map((item, index) => (
                      <div 
                        key={item.id} 
                        className="history-item" 
                        onClick={() => setSelectedHistoryItem(item)} 
                        title={`Prompt: ${item.prompt}`}
                      >
                        <img src={item.generatedImage} alt="Generated history item" />
                        <div className="history-item-number">{index + 1}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-history">
                  <div className="empty-history-icon">📭</div>
                  <div className="empty-history-text">No creations yet. Start generating!</div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {selectedHistoryItem && (
        <div className="modal-overlay" onClick={() => setSelectedHistoryItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Creation Details</h3>
              <button 
                className="modal-close-btn" 
                onClick={() => setSelectedHistoryItem(null)} 
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              <div className="modal-image-wrapper">
                <img 
                  src={selectedHistoryItem.generatedImage} 
                  alt="Selected artwork" 
                  className="modal-image" 
                />
              </div>
              <div className="modal-details">
                <h3>Details</h3>
                <div className="detail-item">
                    <strong>Prompt</strong>
                    <p>{selectedHistoryItem.prompt}</p>
                </div>
                <div className="detail-item">
                    <strong>Aspect Ratio</strong>
                    <p>{selectedHistoryItem.aspectRatio}</p>
                </div>
                {selectedHistoryItem.seed && (
                    <div className="detail-item">
                        <strong>Seed</strong>
                        <p>{selectedHistoryItem.seed}</p>
                    </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => handleImprovise(selectedHistoryItem.generatedImage)} 
                title="Use as new base image"
              >
                <span>🔄</span> Improvise
              </button>
              <button 
                className="btn btn-success" 
                onClick={() => handleDownload(selectedHistoryItem.generatedImage)}
              >
                <span>💾</span> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);