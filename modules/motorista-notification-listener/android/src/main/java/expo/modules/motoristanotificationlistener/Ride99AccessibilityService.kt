package expo.modules.motoristanotificationlistener

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.LinearLayout
import android.widget.TextView
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs

class Ride99AccessibilityService : AccessibilityService() {
  companion object {
    private const val PACKAGE_99 = "com.app99.driver"
    private const val MIN_CAPTURE_INTERVAL_MS = 450L
    private const val OVERLAY_VISIBLE_MS = 8_000L
    private const val OVERLAY_DEDUPE_MS = 20_000L
    private const val MAX_OCR_LINES = 48
    private const val MAX_LINE_CHARS = 220
    private const val GREEN_PER_KM = 2.10
    private const val YELLOW_PER_KM = 1.70
    private const val GREEN_PER_HOUR = 46.0
    private const val YELLOW_PER_HOUR = 35.0
    private val MONEY_TOKEN_REGEX = Regex("""(?:R\$|RS|R5)\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)""", RegexOption.IGNORE_CASE)
    private val KM_REGEX = Regex("""([0-9]{1,3}(?:[.,][0-9]+)?)\s*km\b""", RegexOption.IGNORE_CASE)
    private val METER_REGEX = Regex("""([0-9]{1,4})\s*m\b""", RegexOption.IGNORE_CASE)
    private val MINUTE_REGEX = Regex("""([0-9]{1,3})\s*(?:min|minuto|minutos)\b""", RegexOption.IGNORE_CASE)
    private val HOUR_MINUTE_REGEX = Regex("""([0-9]{1,2})\s*(?:h|hora|horas)\b(?:\s*(?:e)?\s*([0-9]{1,2})\s*(?:min|minuto|minutos)\b)?""", RegexOption.IGNORE_CASE)
    private val PER_KM_REGEX = Regex("""(?:R\$|RS|R5)?\s*([0-9]{1,3}(?:[.,][0-9]{1,2})?)\s*/\s*km""", RegexOption.IGNORE_CASE)
    private val STOP_REGEX = Regex("""\bparada(?:s)?\b""", RegexOption.IGNORE_CASE)
  }

  private data class OcrLine(val text: String, val bounds: Rect)
  private data class RouteLeg(val minutes: Int, val km: Double, val top: Int)
  private data class Decision(val fare: Double, val totalKm: Double, val totalMinutes: Int, val reaisPerKm: Double, val reaisPerHour: Double, val semaphore: String, val hasStops: Boolean, val signature: String)

  private val lastCaptureAt = AtomicLong(0L)
  private val captureInFlight = AtomicBoolean(false)
  private val overlayHandler = Handler(Looper.getMainLooper())
  private var overlayView: View? = null
  private var overlayHideRunnable: Runnable? = null
  private var lastOverlaySignature: String? = null
  private var lastOverlayAt: Long = 0L
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !isRelevantEventType(event.eventType)) return
    if (event.packageName?.toString()?.lowercase() != PACKAGE_99) return
    val now = System.currentTimeMillis()
    val previous = lastCaptureAt.get()
    if (now - previous < MIN_CAPTURE_INTERVAL_MS || !lastCaptureAt.compareAndSet(previous, now) || !captureInFlight.compareAndSet(false, true)) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) { persistStatus(event, "OCR_99: UNSUPPORTED_API"); captureInFlight.set(false); return }
    takeDisplayScreenshot(event)
  }
  override fun onInterrupt() {}
  override fun onDestroy() { hideDecisionOverlay(); try { recognizer.close() } catch (_: Exception) {}; super.onDestroy() }
  private fun isRelevantEventType(t: Int) = t == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || t == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED || t == AccessibilityEvent.TYPE_WINDOWS_CHANGED || t == AccessibilityEvent.TYPE_VIEW_SCROLLED

  private fun takeDisplayScreenshot(event: AccessibilityEvent) {
    try { takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
      override fun onSuccess(screenshot: ScreenshotResult) {
        val buffer = screenshot.hardwareBuffer; var hb: Bitmap? = null; var sb: Bitmap? = null
        try { hb = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace); if (hb == null) { persistStatus(event,"OCR_99: BITMAP_WRAP_FAILED"); captureInFlight.set(false); return }; sb = hb.copy(Bitmap.Config.ARGB_8888,false); if (sb == null) { persistStatus(event,"OCR_99: BITMAP_COPY_FAILED"); captureInFlight.set(false); return }; processBitmap(event,sb) }
        catch (_: Exception) { try { sb?.recycle() } catch (_: Exception) {}; persistStatus(event,"OCR_99: BITMAP_ERROR"); captureInFlight.set(false) }
        finally { try { hb?.recycle() } catch (_: Exception) {}; try { buffer.close() } catch (_: Exception) {} }
      }
      override fun onFailure(errorCode: Int) { persistStatus(event,"OCR_99: SCREENSHOT_ERROR code=$errorCode"); captureInFlight.set(false) }
    }) } catch (_: Exception) { persistStatus(event,"OCR_99: INTERNAL_EXCEPTION"); captureInFlight.set(false) }
  }

  private fun processBitmap(event: AccessibilityEvent, bitmap: Bitmap) {
    recognizer.process(InputImage.fromBitmap(bitmap,0)).addOnSuccessListener { result ->
      try {
        val all = collectLines(result); val fareLine = findMainFareLine(all)
        if (fareLine == null) persistStatus(event,"OCR_99: NO_CURRENT_OFFER_FARE") else {
          val card = isolateCardLines(all,fareLine); val decision = extractDecision(fareLine,card)
          if (decision != null) { showDecisionOverlay(decision); persistOcrResult(event,card,decision) }
          else { persistStatus(event,"OCR_99: DECISION_REJECTED fare=${fareLine.text.take(40)}"); persistRawOperational(event,card) }
        }
      } catch (_: Exception) { persistStatus(event,"OCR_99: RESULT_PROCESSING_ERROR") }
      finally { try { bitmap.recycle() } catch (_: Exception) {}; captureInFlight.set(false) }
    }.addOnFailureListener { e -> persistStatus(event,"OCR_99: OCR_ERROR ${e.javaClass.simpleName}"); try { bitmap.recycle() } catch (_: Exception) {}; captureInFlight.set(false) }
  }

  private fun collectLines(result: Text): List<OcrLine> { val out=mutableListOf<OcrLine>(); for(b in result.textBlocks) for(l in b.lines){val r=l.boundingBox?:continue; if(l.text.trim().isNotBlank()) out.add(OcrLine(l.text.trim(),Rect(r)))}; return out.sortedWith(compareBy<OcrLine>{it.bounds.top}.thenBy{it.bounds.left}) }

  private fun findMainFareLine(lines: List<OcrLine>): OcrLine? {
    val candidates = lines.filter { line ->
      val n=normalize(line.text); val value=extractFareValue(line.text)
      value != null && value >= 3.0 && !n.contains("/km") && !n.contains("tarifa") && !n.contains("dinamic")
    }
    return candidates.maxWithOrNull(compareBy<OcrLine>{it.bounds.height()}.thenBy{it.bounds.width()}.thenBy{it.bounds.top})
  }

  private fun extractFareValue(text: String): Double? {
    val n=normalize(text)
    if(n.contains("/km") || n.contains("tarifa")) return null
    val match=MONEY_TOKEN_REGEX.find(text) ?: return null
    var token=match.groupValues.getOrNull(1) ?: return null
    // 99 commonly renders "R$8,80 1,2x". ML Kit can merge this as
    // "R$8,80 12x"; the old regex greedily consumed it as 8,8012.
    // Currency has exactly two decimal digits, so trim any OCR suffix.
    val comma=token.indexOf(','); val dot=token.indexOf('.')
    val sep=if(comma>=0) comma else dot
    if(sep>=0 && token.length>sep+3) token=token.substring(0,sep+3)
    return parseDecimal(token)?.takeIf{it in 3.0..1000.0}
  }

  private fun isolateCardLines(lines: List<OcrLine>, fareLine: OcrLine): List<OcrLine> { val top=(fareLine.bounds.top-dp(120)).coerceAtLeast(0); val bottom=resources.displayMetrics.heightPixels; return lines.filter{centerY(it.bounds) in top..bottom} }

  private fun extractDecision(fareLine: OcrLine, cardLines: List<OcrLine>): Decision? {
    val fare=extractFareValue(fareLine.text) ?: return null
    val legs=extractRouteLegs(cardLines,fareLine); if(legs.size !in 2..3) return null
    val mins=legs.sumOf{it.minutes}; val km=legs.sumOf{it.km}; if(mins !in 2..360 || km<=0.0 || km>200.0) return null
    val calculatedPerKm=fare/km
    val shownPerKm=cardLines.asSequence().filter{normalize(it.text).contains("/km")}.mapNotNull{PER_KM_REGEX.find(it.text)?.groupValues?.getOrNull(1)?.let(::parseDecimal)}.firstOrNull{it>0.0}
    // 99 itself shows the offer R$/km. Prefer that authoritative value because
    // the UI's pickup distance can be rounded (e.g. 712 m) while the platform
    // computes the metric from its precise route distance.
    val reaisPerKm=shownPerKm ?: calculatedPerKm
    if(shownPerKm != null && abs(calculatedPerKm-shownPerKm) > 0.45) return null
    val reaisPerHour=fare/(mins/60.0)
    val semaphore=when { reaisPerKm>=GREEN_PER_KM && reaisPerHour>=GREEN_PER_HOUR -> "green"; reaisPerKm<YELLOW_PER_KM || reaisPerHour<YELLOW_PER_HOUR -> "red"; else -> "yellow" }
    val stops=legs.size==3 || cardLines.any{STOP_REGEX.containsMatchIn(it.text)}
    val sig=listOf("99",(fare*100).toInt().toString(),String.format(Locale.US,"%.2f",km),mins.toString(),stops.toString()).joinToString("|")
    return Decision(fare,km,mins,reaisPerKm,reaisPerHour,semaphore,stops,sig)
  }

  private fun extractRouteLegs(lines: List<OcrLine>, fareLine: OcrLine): List<RouteLeg> {
    val route=lines.filter{it.bounds.top>fareLine.bounds.bottom && !normalize(it.text).contains("/km") && !normalize(it.text).contains("tarifa")}
    val direct=LinkedHashMap<String,RouteLeg>(); for(line in route){val m=parseDurationMinutes(line.text)?:continue; val k=parseDistanceKm(line.text)?:continue; if(k<=0||k>150)continue; direct.putIfAbsent("$m|${String.format(Locale.US,"%.3f",k)}",RouteLeg(m,k,line.bounds.top))}; if(direct.size in 2..3)return direct.values.sortedBy{it.top}
    val times=route.mapNotNull{l->parseDurationMinutes(l.text)?.let{it to l}}; val dists=route.mapNotNull{l->parseDistanceKm(l.text)?.let{it to l}}; val used=HashSet<Int>(); val paired=LinkedHashMap<String,RouteLeg>()
    for((m,tl) in times){var bi=-1;var bs=Int.MAX_VALUE;dists.forEachIndexed{i,p->if(!used.contains(i)){val dy=abs(centerY(tl.bounds)-centerY(p.second.bounds));if(dy<bs){bs=dy;bi=i}}};if(bi>=0&&bs<=dp(52)){used.add(bi);val k=dists[bi].first;if(k>0&&k<=150)paired.putIfAbsent("$m|${String.format(Locale.US,"%.3f",k)}",RouteLeg(m,k,minOf(tl.bounds.top,dists[bi].second.bounds.top)))}}
    return paired.values.sortedBy{it.top}
  }
  private fun parseDurationMinutes(text:String):Int?{val h=HOUR_MINUTE_REGEX.find(text);if(h!=null){val hr=h.groupValues[1].toIntOrNull()?:return null;val mi=h.groupValues.getOrNull(2)?.toIntOrNull()?:0;return(hr*60+mi).takeIf{it in 1..360}};return MINUTE_REGEX.find(text)?.groupValues?.getOrNull(1)?.toIntOrNull()?.takeIf{it in 1..360}}
  private fun parseDistanceKm(text:String):Double?{KM_REGEX.find(text)?.groupValues?.getOrNull(1)?.let(::parseDecimal)?.let{return it};METER_REGEX.find(text)?.groupValues?.getOrNull(1)?.toDoubleOrNull()?.let{return it/1000.0};return null}

  private fun showDecisionOverlay(d:Decision){val now=System.currentTimeMillis();if(d.signature==lastOverlaySignature&&now-lastOverlayAt<=OVERLAY_DEDUPE_MS)return;lastOverlaySignature=d.signature;lastOverlayAt=now;overlayHandler.post{hideDecisionOverlay();val wm=getSystemService(WINDOW_SERVICE) as WindowManager;val c=when(d.semaphore){"green"->Color.rgb(28,185,84);"red"->Color.rgb(234,67,53);else->Color.rgb(251,188,4)};val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(14),dp(10),dp(14),dp(9));background=GradientDrawable().apply{shape=GradientDrawable.RECTANGLE;cornerRadius=dp(14).toFloat();setColor(Color.WHITE);setStroke(dp(5),c)};elevation=dp(10).toFloat()};val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL};row.addView(metricColumn("R$/Km",format2(d.reaisPerKm),c),weightedParams());row.addView(metricColumn("R$/Hora",format2(d.reaisPerHour),c),weightedParams());row.addView(metricColumn("Sinal","●",c,true),weightedParams());root.addView(row);root.addView(TextView(this).apply{text="${d.totalMinutes}min • ${format1(d.totalKm)}km"+(if(d.hasStops)" • PAR" else "");setTextColor(Color.rgb(20,20,20));textSize=19f;setTypeface(typeface,android.graphics.Typeface.BOLD);setPadding(dp(4),dp(5),dp(4),0)});val p=WindowManager.LayoutParams((resources.displayMetrics.widthPixels*.82f).toInt(),WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT).apply{gravity=Gravity.TOP or Gravity.CENTER_HORIZONTAL;y=dp(70)};try{wm.addView(root,p);overlayView=root;val hide=Runnable{hideDecisionOverlay()};overlayHideRunnable=hide;overlayHandler.postDelayed(hide,OVERLAY_VISIBLE_MS)}catch(_:Exception){overlayView=null}}}
  private fun metricColumn(label:String,value:String,accent:Int,semaphoreDot:Boolean=false)=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(5),0,dp(5),0);addView(TextView(this@Ride99AccessibilityService).apply{text=label;setTextColor(Color.rgb(110,110,110));textSize=13f});addView(TextView(this@Ride99AccessibilityService).apply{text=value;setTextColor(if(semaphoreDot)accent else Color.BLACK);textSize=if(semaphoreDot)34f else 27f;setTypeface(typeface,android.graphics.Typeface.BOLD)})}
  private fun weightedParams()=LinearLayout.LayoutParams(0,WindowManager.LayoutParams.WRAP_CONTENT,1f)
  private fun hideDecisionOverlay(){overlayHideRunnable?.let{overlayHandler.removeCallbacks(it)};overlayHideRunnable=null;val v=overlayView?:return;overlayView=null;try{(getSystemService(WINDOW_SERVICE) as WindowManager).removeView(v)}catch(_:Exception){}}

  private fun persistOcrResult(event:AccessibilityEvent,lines:List<OcrLine>,d:Decision){val nodes=JSONArray();nodes.put(nodeJson("99 • R$ ${format2(d.fare)} • TOTAL ${format1(d.totalKm)} km • ${d.totalMinutes} min • R$ ${format2(d.reaisPerKm)}/km • R$ ${format2(d.reaisPerHour)}/h",Rect(0,0,0,0),event.windowId));val seen=HashSet<String>();for(l in lines){if(nodes.length()>=MAX_OCR_LINES)break;if(!isOperational(l.text))continue;if(seen.add(normalize(l.text)))nodes.put(nodeJson(l.text.take(MAX_LINE_CHARS),l.bounds,event.windowId))};appendSnapshot(event,nodes,"screenshotOcr99:${d.signature}")}
  private fun persistRawOperational(event:AccessibilityEvent,lines:List<OcrLine>){val nodes=JSONArray();val seen=HashSet<String>();for(l in lines){if(nodes.length()>=MAX_OCR_LINES)break;if(!isOperational(l.text))continue;if(seen.add(normalize(l.text)))nodes.put(nodeJson(l.text.take(MAX_LINE_CHARS),l.bounds,event.windowId))};if(nodes.length()>0)appendSnapshot(event,nodes,"screenshotOcr99Rejected:${System.currentTimeMillis()}")}
  private fun persistStatus(event:AccessibilityEvent,detail:String){appendSnapshot(event,JSONArray().put(nodeJson(detail.take(MAX_LINE_CHARS*2),Rect(0,0,0,0),event.windowId)),"screenshotOcr99Status:${detail.hashCode()}:${System.currentTimeMillis()}")}
  private fun appendSnapshot(event:AccessibilityEvent,nodes:JSONArray,fingerprint:String){val s=JSONObject().apply{put("packageName",PACKAGE_99);put("eventType",event.eventType);put("capturedAt",System.currentTimeMillis());put("nodeCount",nodes.length());put("nodes",nodes);put("fingerprint",fingerprint);put("truncated",false);put("origins",JSONArray().put("screenshotOcr99"))};try{RideAccessibilityStore.append(applicationContext,s)}catch(_:Exception){}}
  private fun nodeJson(text:String,b:Rect,w:Int)=JSONObject().apply{put("text",text);put("viewId",JSONObject.NULL);put("className","Ocr99Line");put("left",b.left);put("top",b.top);put("right",b.right);put("bottom",b.bottom);put("clickable",false);put("origin","screenshotOcr99");put("windowId",w)}
  private fun isOperational(v:String):Boolean{val n=normalize(v);return MONEY_TOKEN_REGEX.containsMatchIn(v)||KM_REGEX.containsMatchIn(v)||METER_REGEX.containsMatchIn(v)||MINUTE_REGEX.containsMatchIn(v)||HOUR_MINUTE_REGEX.containsMatchIn(v)||n.contains("perfil essencial")||n.contains("tarifa")||n.contains("corridas")||n.contains("parada")}
  private fun parseDecimal(v:String):Double?{val c=v.trim().replace(" ","");if(c.isBlank())return null;return if(c.contains(','))c.replace(".","").replace(',','.').toDoubleOrNull() else c.toDoubleOrNull()}
  private fun centerY(r:Rect)=r.top+r.height()/2
  private fun normalize(v:String)=v.lowercase().replace(Regex("""\s+""")," ").trim()
  private fun format1(v:Double)=String.format(Locale.US,"%.1f",v).replace('.',',')
  private fun format2(v:Double)=String.format(Locale.US,"%.2f",v).replace('.',',')
  private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()
}
