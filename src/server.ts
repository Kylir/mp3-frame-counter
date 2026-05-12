import express from 'express';
import multer from 'multer';
import { analyzeFile } from './analyzer';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/file-upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const result = analyzeFile(req.file.buffer);
  res.json(result);
});

export default app;
