import { useState } from 'react'
import { generateR68XML, type R68Claim } from '../lib/hmrc-xml'

export default function TestSubmission() {
  const [xmlOutput, setXmlOutput] = useState('')
  const [downloadReady, setDownloadReady] = useState(false)

  const generateTestXML = () => {
    const testClaim: R68Claim = {
      charity: {
        regulatorCode: 'CCEW',
        charityNumber: '1234567', // Use test charity number from HMRC
        charityHMRCRef: 'A1234B',
        connectedCharities: false,
        communityBuildings: false
      },
      donations: [
        {
          donor: {
            forename: 'John',
            surname: 'Smith',
            houseNameNumber: '10',
            postcode: 'SW1A 1AA'
          },
          date: '2024-01-15',
          amount: 100.00,
          sponsored: false,
          aggregated: false
        },
        {
          donor: {
            title: 'Mrs',
            forename: 'Jane',
            surname: 'Doe',
            houseNameNumber: '25',
            postcode: 'M1 1AA'
          },
          date: '2024-01-20',
          amount: 250.00,
          sponsored: false,
          aggregated: false
        }
      ],
      taxYear: '2023-24',
      adjustment: false,
      otherIncome: 0
    }

    const xml = generateR68XML(testClaim, true) // true = test mode
    setXmlOutput(xml)
    setDownloadReady(true)
  }

  const downloadXML = () => {
    const blob = new Blob([xmlOutput], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `test-claim-${Date.now()}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Test HMRC XML Generation</h1>
      
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <button
          onClick={generateTestXML}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Generate Test XML
        </button>

        {xmlOutput && (
          <>
            <div className="bg-gray-50 p-4 rounded overflow-x-auto">
              <pre className="text-xs">{xmlOutput}</pre>
            </div>

            <div className="flex gap-4">
              <button
                onClick={downloadXML}
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Download XML for LTS Testing
              </button>
              
              <p className="text-sm text-gray-600 flex items-center">
                Download this file and test it with the HMRC Local Test Service (LTS) tool
              </p>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 bg-yellow-50 p-6 rounded-lg">
        <h3 className="font-bold mb-2">Testing Checklist:</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>Generate test XML using button above</li>
          <li>Download the XML file</li>
          <li>Open HMRC Local Test Service (LTS) tool</li>
          <li>Load the XML file into LTS</li>
          <li>Check for validation errors</li>
          <li>Fix any issues and regenerate</li>
          <li>Once LTS validates successfully, proceed to ETS testing</li>
        </ol>
      </div>
    </div>
  )
}
