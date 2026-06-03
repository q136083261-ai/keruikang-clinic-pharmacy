let barcodeStream=null,barcodeTimer=null,currentScannerTarget="medicineBarcode";
const scannerModal=document.getElementById("scannerModal"),barcodeVideo=document.getElementById("barcodeVideo"),scannerStatus=document.getElementById("scannerStatus");
function scannerToast(text){toast(text)}
function stopBarcodeScanner(){if(barcodeTimer){clearInterval(barcodeTimer);barcodeTimer=null}if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null}scannerModal.classList.remove("open");if(!document.querySelector(".modal.open:not(#scannerModal)"))document.getElementById("modalBackdrop").classList.remove("open")}
async function startBarcodeScanner(targetId="medicineBarcode"){
  currentScannerTarget=targetId;
  if(!("BarcodeDetector" in window))return scannerToast("当前浏览器不支持摄像头识别，请使用 USB 扫码枪或手动输入");
  if(!navigator.mediaDevices?.getUserMedia)return scannerToast("当前环境无法调用摄像头，请使用扫码枪或手动输入");
  try{
    const formats=await BarcodeDetector.getSupportedFormats(),preferred=["ean_13","ean_8","upc_a","upc_e","code_128","code_39","qr_code","data_matrix"].filter(x=>formats.includes(x)),detector=new BarcodeDetector({formats:preferred.length?preferred:formats});
    barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});barcodeVideo.srcObject=barcodeStream;scannerModal.classList.add("open");document.getElementById("modalBackdrop").classList.add("open");scannerStatus.textContent="正在识别，请将条码或二维码放入扫描框内";
    barcodeTimer=setInterval(async()=>{try{const results=await detector.detect(barcodeVideo);if(results.length){const raw=results[0].rawValue;stopBarcodeScanner();scannerToast("条码已识别："+raw);if(window.handleScannedBarcode)window.handleScannedBarcode(raw,currentScannerTarget);else{const input=document.getElementById(currentScannerTarget);if(input)input.value=raw}}}catch{}},450);
  }catch{scannerToast("摄像头无法使用，请检查授权或使用 USB 扫码枪");stopBarcodeScanner()}
}
document.addEventListener("click",e=>{const button=e.target.closest("[data-scan-target]");if(button)startBarcodeScanner(button.dataset.scanTarget)});
document.getElementById("startBarcodeScanner").onclick=()=>startBarcodeScanner("medicineBarcode");
document.getElementById("stopBarcodeScanner").onclick=stopBarcodeScanner;
document.getElementById("modalBackdrop").addEventListener("click",()=>{if(scannerModal.classList.contains("open"))stopBarcodeScanner()});
document.addEventListener("keydown",e=>{const input=e.target.closest(".barcode-scan-input");if(input&&e.key==="Enter"){e.preventDefault();scannerToast("条码已录入："+input.value)}});
