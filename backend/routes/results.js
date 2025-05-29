const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send('Results route OK');
});

module.exports = router;
