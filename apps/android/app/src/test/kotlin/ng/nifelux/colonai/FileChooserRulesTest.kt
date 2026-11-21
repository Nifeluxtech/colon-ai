package ng.nifelux.colonai

import ng.nifelux.colonai.FileChooserRules.Picker
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class FileChooserRulesTest {
    private val files = arrayOf("image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.txt")

    @Test fun cameraNeedsCaptureOnAnImageInput() {
        assertEquals(Picker.CAMERA, FileChooserRules.picker(arrayOf("image/*"), true))
        assertEquals(Picker.CAMERA, FileChooserRules.picker(arrayOf("image/png", "image/jpeg"), true))
        assertEquals(Picker.FILES, FileChooserRules.picker(files, true))
        assertEquals(Picker.FILES, FileChooserRules.picker(arrayOf(""), true))
    }

    @Test fun imagesOnlyOpenThePhotoPicker() {
        assertEquals(Picker.PHOTOS, FileChooserRules.picker(arrayOf("image/*"), false))
        assertEquals(Picker.PHOTOS, FileChooserRules.picker(arrayOf(".png,.jpg"), false))
    }

    @Test fun anythingElseOpensTheDocumentPicker() {
        assertEquals(Picker.FILES, FileChooserRules.picker(files, false))
        assertEquals(Picker.FILES, FileChooserRules.picker(null, false))
        assertArrayEquals(arrayOf("*/*"), FileChooserRules.documentTypes(arrayOf("")))
        assertArrayEquals(arrayOf("*/*"), FileChooserRules.documentTypes(arrayOf(".png,.xyz")))
        assertArrayEquals(arrayOf("application/pdf", "text/*"), FileChooserRules.documentTypes(arrayOf(".pdf, .md,.csv")))
    }
}
