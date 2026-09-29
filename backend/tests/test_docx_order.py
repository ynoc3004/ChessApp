import tempfile
import unittest
import zipfile
from pathlib import Path

import cv2
import numpy as np

from app.detector import docx_image_metadata, extract_docx_images


class DocxOrderTests(unittest.TestCase):
    def test_document_order_and_skipped_vector_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "example.docx"
            def png(value):
                return cv2.imencode(".png", np.full((2, 2, 3), value, dtype=np.uint8))[1].tobytes()

            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("word/media/first.png", png(10))
                archive.writestr("word/media/second.png", png(200))
                archive.writestr("word/media/vector.emf", b"vector")
                archive.writestr("word/_rels/document.xml.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/first.png"/>
                  <Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/second.png"/>
                  <Relationship Id="r3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/vector.emf"/>
                </Relationships>''')
                archive.writestr("word/document.xml", '''<document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <a:blip r:embed="r2"/><a:blip r:embed="r3"/><a:blip r:embed="r1"/>
                </document>''')

            images = list(extract_docx_images(path))
            self.assertEqual([name for name, _ in images], ["word/media/second.png", "word/media/first.png"])
            self.assertEqual(int(images[0][1][0, 0, 0]), 200)
            self.assertEqual(docx_image_metadata(path), {"skippedVectorImages": 1})
