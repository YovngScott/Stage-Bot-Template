import React from 'react';
import { createRoot } from 'react-dom/client';
import { InstagramWorkspace } from '../src/components/dashboard/InstagramWorkspace';
import '../src/styles.css';
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl p-4 sm:p-10"><h1 className="mb-8 text-3xl font-semibold">Conexiones</h1><InstagramWorkspace /></main>);
