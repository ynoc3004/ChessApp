const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send('Chat route OK');
});

module.exports = router;
