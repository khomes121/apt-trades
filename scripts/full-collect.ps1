param(
    [string]$ApiKey = $env:MOLIT_API_KEY,
    [string]$CfToken = $env:CLOUDFLARE_API_TOKEN,
    [string]$DbName = "apt-trades",
    [int]$Months = 24,
    [int]$DelayMs = 120
)

$ErrorActionPreference = "Continue"
$API_BASE = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
$env:CLOUDFLARE_API_TOKEN = $CfToken

Write-Host "=== Full collect start ===" -ForegroundColor Cyan

$targetMonths = @()
$now = Get-Date
for ($i = $Months; $i -ge 1; $i--) {
    $d = $now.AddMonths(-$i)
    $targetMonths += $d.ToString("yyyyMM")
}

Write-Host "Getting region codes..." -ForegroundColor Yellow
$tmpJson = [System.IO.Path]::GetTempFileName()
cmd /c "npx wrangler d1 execute $DbName --remote --command ""SELECT sgg_cd FROM regions ORDER BY sgg_cd"" --json > ""$tmpJson"" 2>&1"
$regionsRaw = Get-Content $tmpJson -Raw
Remove-Item $tmpJson -Force
$idx = $regionsRaw.IndexOf('[')
if ($idx -ge 0) { $regionsRaw = $regionsRaw.Substring($idx) }
$regions = ($regionsRaw | ConvertFrom-Json)[0].results | ForEach-Object { $_.sgg_cd }
Write-Host "Regions: $($regions.Count) / Months: $($targetMonths.Count)" -ForegroundColor Yellow

$totalCount = 0
$callCount = 0
$tmpFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.sql'

foreach ($sggCd in $regions) {
    foreach ($dealYmd in $targetMonths) {
        $callCount++
        try {
            $url = "${API_BASE}?serviceKey=${ApiKey}&LAWD_CD=${sggCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1"
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
            [xml]$xml = $response.Content

            $resultCode = $xml.response.header.resultCode
            if ($resultCode -ne "000") {
                continue
            }

            $items = $xml.response.body.items.item
            if (-not $items) {
                Write-Host -NoNewline "."
                continue
            }

            $rows = @()
            foreach ($item in $items) {
                $aptSeq     = if ($item.aptSeq.Trim())           { "'" + $item.aptSeq.Trim().Replace("'","''") + "'" }           else { "NULL" }
                $aptNm      = "'" + $item.aptNm.Trim().Replace("'","''") + "'"
                $aptDong    = if ($item.aptDong.Trim())          { "'" + $item.aptDong.Trim().Replace("'","''") + "'" }          else { "NULL" }
                $umdNm      = if ($item.umdNm.Trim())            { "'" + $item.umdNm.Trim().Replace("'","''") + "'" }            else { "NULL" }
                $umdCd      = if ($item.umdCd.Trim())            { "'" + $item.umdCd.Trim() + "'" }                              else { "NULL" }
                $roadNm     = if ($item.roadNm.Trim())           { "'" + $item.roadNm.Trim().Replace("'","''") + "'" }           else { "NULL" }
                $bonbun     = if ($item.bonbun.Trim())           { "'" + $item.bonbun.Trim() + "'" }                             else { "NULL" }
                $bubun      = if ($item.bubun.Trim())            { "'" + $item.bubun.Trim() + "'" }                              else { "NULL" }
                $buildYear  = if ($item.buildYear -match '^\d+$') { $item.buildYear }                                            else { "NULL" }
                $excluUseAr = [double]$item.excluUseAr
                $areaGroup  = [math]::Round($excluUseAr)
                $floor      = if ($item.floor -match '^-?\d+$') { $item.floor }                                                  else { "NULL" }
                $dealAmount = [int]($item.dealAmount.Replace(",","").Trim())
                $dealDate   = "$($item.dealYear.Trim())-$($item.dealMonth.Trim().PadLeft(2,'0'))-$($item.dealDay.Trim().PadLeft(2,'0'))"
                $dealingGbn = if ($item.dealingGbn.Trim())       { "'" + $item.dealingGbn.Trim() + "'" }                        else { "NULL" }
                $slerGbn    = if ($item.slerGbn.Trim())          { "'" + $item.slerGbn.Trim() + "'" }                           else { "NULL" }
                $buyerGbn   = if ($item.buyerGbn.Trim())         { "'" + $item.buyerGbn.Trim() + "'" }                          else { "NULL" }
                $cdealType  = if ($item.cdealType.Trim())        { "'" + $item.cdealType.Trim() + "'" }                         else { "NULL" }
                $cdealDay   = if ($item.cdealDay.Trim())         { "'" + $item.cdealDay.Trim() + "'" }                          else { "NULL" }
                $rgstDate   = if ($item.rgstDate.Trim())         { "'" + $item.rgstDate.Trim() + "'" }                          else { "NULL" }
                $landLease  = if ($item.landLeaseholdGbn.Trim()) { "'" + $item.landLeaseholdGbn.Trim() + "'" }                  else { "NULL" }

                $rows += "($aptSeq,$aptNm,$aptDong,'$sggCd',$umdNm,$umdCd,$roadNm,$bonbun,$bubun,$buildYear,$excluUseAr,$areaGroup,$floor,$dealAmount,'$dealDate',$dealingGbn,$slerGbn,$buyerGbn,$cdealType,$cdealDay,$rgstDate,$landLease)"
            }

            if ($rows.Count -eq 0) {
                Write-Host -NoNewline "."
                continue
            }

            $sql = "INSERT OR IGNORE INTO apt_trades (apt_seq,apt_nm,apt_dong,sgg_cd,umd_nm,umd_cd,road_nm,bonbun,bubun,build_year,exclu_use_ar,area_group,floor,deal_amount,deal_date,dealing_gbn,sler_gbn,buyer_gbn,cdeal_type,cdeal_day,rgst_date,land_leasehold) VALUES " + ($rows -join ",") + ";"
            Set-Content -Path $tmpFile -Value $sql -Encoding UTF8

            $tmpJson2 = [System.IO.Path]::GetTempFileName()
            cmd /c "npx wrangler d1 execute $DbName --remote --file=""$tmpFile"" --json > ""$tmpJson2"" 2>&1"
            $rawResult = Get-Content $tmpJson2 -Raw
            Remove-Item $tmpJson2 -Force
            $idx2 = $rawResult.IndexOf('[')
            if ($idx2 -ge 0) { $rawResult = $rawResult.Substring($idx2) }
            $changes = 0
            try { $changes = ($rawResult | ConvertFrom-Json)[0].meta.changes } catch {}
            $totalCount += $changes
            if ($changes -gt 0) {
                Write-Host "  [$callCount] ${sggCd}/${dealYmd}: ${changes}" -ForegroundColor Green
            }

        } catch {
            Write-Host "`n  Error ${sggCd}/${dealYmd}: $_" -ForegroundColor Red
        }

        Start-Sleep -Milliseconds $DelayMs
    }
}

if (Test-Path $tmpFile) { Remove-Item $tmpFile }

Write-Host "`n=== Done. Total: ${totalCount} ===" -ForegroundColor Cyan
