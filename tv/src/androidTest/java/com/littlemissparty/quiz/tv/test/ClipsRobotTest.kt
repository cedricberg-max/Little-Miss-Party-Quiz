package com.littlemissparty.quiz.tv.test

import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.littlemissparty.quiz.tv.habillage.CATALOGUE
import com.littlemissparty.quiz.tv.habillage.programmeAlpha
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/**
 * Robot du design « The Game Show » : chaque clip du catalogue se décode sur la box (MP4, moitié haute l'image, moitié
 * basse la transparence) et le shader de [com.littlemissparty.quiz.tv.habillage.LecteurAlpha] le recompose bien :
 * un robot plein (opaque), sur un fond vraiment transparent. Comme sur la TV, mais dans une image hors écran.
 */
@RunWith(AndroidJUnit4::class)
class ClipsRobotTest {

    private val l = 80
    private val h = 100

    @Test
    fun chaqueClipSeLitAvecSaTransparence() {
        val signaux = HandlerThread("clips-robot").apply { start() }
        try {
            for (clip in CATALOGUE) {
                val (opaques, transparents) = try {
                    mesurer(clip.fichier, Handler(signaux.looper))
                } catch (e: Throwable) {
                    throw AssertionError("${clip.fichier} : ${e.message}", e)
                }
                val total = l * h
                assertTrue("${clip.fichier} : robot trop transparent ($opaques pixels pleins sur $total)", opaques >= total * 0.03)
                assertTrue("${clip.fichier} : fond pas transparent ($transparents pixels transparents sur $total)", transparents >= total * 0.2)
            }
        } finally {
            signaux.quitSafely()
        }
    }

    /** Joue le clip 1,5 s, recompose la dernière image et compte ses pixels pleins et transparents. */
    private fun mesurer(fichier: String, signaux: Handler): Pair<Int, Int> {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        val resId = contexte.resources.getIdentifier(fichier, "raw", contexte.packageName)
        check(resId != 0) { "clip absent de l'appli" }
        val egl = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val v = IntArray(2)
        check(EGL14.eglInitialize(egl, v, 0, v, 1))
        val configs = arrayOfNulls<EGLConfig>(1)
        val n = IntArray(1)
        val attributs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE,
        )
        check(EGL14.eglChooseConfig(egl, attributs, 0, configs, 0, 1, n, 0) && n[0] > 0) { "pas de configuration EGL" }
        val ctx = EGL14.eglCreateContext(egl, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        val surface = EGL14.eglCreatePbufferSurface(egl, configs[0], intArrayOf(EGL14.EGL_WIDTH, l, EGL14.EGL_HEIGHT, h, EGL14.EGL_NONE), 0)
        check(EGL14.eglMakeCurrent(egl, surface, surface, ctx)) { "pas de contexte OpenGL" }
        var lecteur: MediaPlayer? = null
        var video: SurfaceTexture? = null
        var sortie: Surface? = null
        try {
            val programme = programmeAlpha()
            check(programme != 0) { "shader refusé" }
            val t = IntArray(1)
            GLES20.glGenTextures(1, t, 0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, t[0])
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            // Les images décodées sont signalées sur un autre fil ; on les prend ici, où est le contexte OpenGL.
            val nouvelles = AtomicInteger()
            val st = SurfaceTexture(t[0]).also { video = it }
            st.setOnFrameAvailableListener({ nouvelles.incrementAndGet() }, signaux)
            sortie = Surface(st)
            lecteur = MediaPlayer().apply {
                contexte.resources.openRawResourceFd(resId).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(sortie)
                prepare()
                start()
            }
            var images = 0
            val fin = System.currentTimeMillis() + 1_500
            while (System.currentTimeMillis() < fin || (images == 0 && System.currentTimeMillis() < fin + 8_000)) {
                if (nouvelles.getAndSet(0) > 0) {
                    st.updateTexImage()
                    images++
                }
                Thread.sleep(20)
            }
            check(images > 0) { "aucune image décodée" }
            val m = FloatArray(16)
            st.getTransformMatrix(m)
            GLES20.glViewport(0, 0, l, h)
            GLES20.glClearColor(0f, 0f, 0f, 0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glUseProgram(programme)
            GLES20.glUniform1i(GLES20.glGetUniformLocation(programme, "uTex"), 0)
            GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(programme, "uM"), 1, false, m, 0)
            val quad = ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder()).asFloatBuffer()
                .apply { put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)); position(0) }
            val pos = GLES20.glGetAttribLocation(programme, "aPos")
            GLES20.glEnableVertexAttribArray(pos)
            GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            val pixels = ByteBuffer.allocateDirect(l * h * 4)
            GLES20.glReadPixels(0, 0, l, h, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixels)
            var opaques = 0
            var transparents = 0
            for (i in 0 until l * h) {
                val a = pixels.get(i * 4 + 3).toInt() and 0xff
                if (a >= 250) opaques++
                if (a <= 5) transparents++
            }
            return opaques to transparents
        } finally {
            lecteur?.release()
            sortie?.release()
            video?.release()
            EGL14.eglMakeCurrent(egl, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(egl, surface)
            EGL14.eglDestroyContext(egl, ctx)
        }
    }
}
